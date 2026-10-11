"""Notification service layer.

Delivery helpers used by the management commands and the S21 signal handler.
All functions are importable independently so the call site can be stubbed or
replaced without touching the delivery logic.

S21 call sites
--------------
Signals in app/signals.py call `notify_content_update` automatically when a
Module or ContentItem is saved (see AppConfig.ready() in apps.py).

If the admin write path from #69 is not yet merged, wire the call site manually:

    # TODO (#69): call after bulk-publish in admin write view
    from app.notifications import notify_content_update
    notify_content_update(module=module_instance)
"""

import json
import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .access import module_content_completed, module_is_unlocked
from .models import (
    Enrollment,
    NotificationLog,
    NotificationPreference,
    PushSubscription,
    Survey,
    SurveyResponse,
)

logger = logging.getLogger(__name__)

# No reminder fires within this many minutes of a previous one for the same module.
CONTENT_UPDATE_DEBOUNCE_MINUTES = 60


def _get_pref(user):
    """Return the user's NotificationPreference, or None if they have never saved one."""
    try:
        return user.notification_preference
    except NotificationPreference.DoesNotExist:
        return None


def send_push(user, payload_dict, push_subs):
    """
    Attempt to deliver a push notification to all of the user's registered
    endpoints. Prunes endpoints that return 404 or 410 (gone).

    Returns True if at least one device accepted it.
    """
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush not installed — push skipped for user %s", user.pk)
        return False

    if not settings.VAPID_PRIVATE_KEY:
        logger.warning("VAPID_PRIVATE_KEY not configured — push skipped")
        return False

    payload = json.dumps(payload_dict)
    sent_any = False

    for sub in list(push_subs):
        # Already pruned by an earlier send in this run (the caller may reuse its list).
        if sub.pk is None:
            continue
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": f"mailto:{settings.VAPID_ADMIN_EMAIL}"},
                content_encoding="aes128gcm",
            )
            sent_any = True
        except WebPushException as exc:
            resp = getattr(exc, "response", None)
            if resp is not None and resp.status_code in (404, 410):
                sub.delete()
                logger.info("Pruned dead push endpoint for user %s", user.pk)
            else:
                logger.warning("Push failed for user %s: %s", user.pk, exc)
        except Exception as exc:
            logger.warning("Push error for user %s: %s", user.pk, exc)

    return sent_any


def deliver(user, payload_dict, push_subs=None):
    """
    Send *payload_dict* as a web push to every device *user* has registered.

    *push_subs* lets a caller that has already loaded the user's subscriptions
    pass them in; otherwise they are fetched here.

    Returns the NotificationLog.Status for the attempt:
        SKIPPED  the user refused notifications or has no registered device
        SENT     at least one device accepted it
        FAILED   they have devices but none accepted it (or push isn't configured)
    """
    pref = _get_pref(user)
    if pref and pref.push_denied:
        return NotificationLog.Status.SKIPPED

    if push_subs is None:
        push_subs = list(PushSubscription.objects.filter(user=user))
    if not push_subs:
        return NotificationLog.Status.SKIPPED

    if send_push(user, payload_dict, push_subs):
        return NotificationLog.Status.SENT
    return NotificationLog.Status.FAILED


def deliver_and_log(
    user,
    notification_type,
    payload_dict,
    module=None,
    content_item=None,
    scheduled_for=None,
    push_subs=None,
):
    """deliver(), then record the attempt in NotificationLog.

    Only SENT rows count as delivered, so callers retry SKIPPED and FAILED ones on
    their next run (a user may register a device in between).
    Returns the status.
    """
    status = deliver(user=user, payload_dict=payload_dict, push_subs=push_subs)
    now = timezone.now()
    NotificationLog.objects.create(
        user=user,
        type=notification_type,
        module=module,
        content_item=content_item,
        channel=NotificationLog.Channel.PUSH,
        scheduled_for=scheduled_for or now,
        sent_at=now if status == NotificationLog.Status.SENT else None,
        status=status,
    )
    return status


# ── S21: content added / changed ───────────────────────────────────────────────

def notify_content_update(module=None, content_item=None):
    """
    Send a content-added/changed notification to students whose cohort includes
    *module* (or the module owning *content_item*).

    Debounced: if a CONTENT_UPDATE notification for this module was already
    logged within CONTENT_UPDATE_DEBOUNCE_MINUTES, the call is a no-op.

    Only ACTIVE enrollments whose cohort has not yet finished receive the
    notification — no point alerting students about a module they've already
    passed. Students for whom the module is still locked are skipped too.

    S21 wiring: called automatically by signals in app/signals.py.
    """
    if content_item is not None and module is None:
        module = content_item.module

    if module is None:
        return

    if not module.is_published:
        return

    cutoff = timezone.now() - timedelta(minutes=CONTENT_UPDATE_DEBOUNCE_MINUTES)
    if NotificationLog.objects.filter(
        type=NotificationLog.NotificationType.CONTENT_UPDATE,
        module=module,
        scheduled_for__gte=cutoff,
    ).exists():
        logger.debug("Debounced content-update notification for module %s", module)
        return

    # TIME_ZONE is Australia/Perth, so this is today's date in Perth.
    today = timezone.localdate()

    # Only notify students in cohorts that are currently running:
    #   start_date <= today <= end_date
    # This gates out cohorts that haven't begun yet (setup window) and cohorts
    # that have already finished.
    affected_enrollments = (
        Enrollment.objects
        .filter(
            status=Enrollment.Status.ACTIVE,
            cohort__start_date__lte=today,
            cohort__end_date__gte=today,
        )
        .select_related("user", "cohort", "user__notification_preference")
        .distinct()
    )

    scheduled_for = timezone.now()
    sent = 0
    notified_user_ids = set()

    for enr in affected_enrollments:
        user = enr.user

        # A user with more than one running enrollment gets one notice, not one per cohort.
        if user.pk in notified_user_ids:
            continue
        notified_user_ids.add(user.pk)

        # Skip users for whom this week is still locked; they would only hit a
        # 403. They are told when it opens by send_module_unlock_notifications.
        if not module_is_unlocked(module, user):
            continue

        if deliver_and_log(
            user=user,
            notification_type=NotificationLog.NotificationType.CONTENT_UPDATE,
            payload_dict={
                "title": f"New content: {module.week_label}",
                "body": module.title,
                "url": f"/modules/{module.id}",
            },
            module=module,
            scheduled_for=scheduled_for,
        ) == NotificationLog.Status.SENT:
            sent += 1

    logger.info("S21 content-update: module=%s sent=%d", module, sent)


def notify_survey_unlocked(user, module):
    """
    Notify a user when completing all content in a module
    unlocks its weekly survey.
    """
    pref = _get_pref(user)

    # User disabled the "survey unlocked" notification.
    if pref is None or not pref.survey_unlocked_reminder:
        return False

    # Module itself must already be available to this user.
    if not module_is_unlocked(module, user):
        return False

    # Same rule as access.survey_is_unlocked: every ContentItem in the module is
    # completed. A module with no content never triggers this notice.
    if not module.content_items.exists() or not module_content_completed(module, user):
        return False

    surveys = Survey.objects.filter(
        module=module,
        type=Survey.SurveyType.WEEKLY,
    )

    sent_any = False

    for survey in surveys:
        # No need to notify if the user already submitted it.
        if SurveyResponse.objects.filter(user=user, survey=survey).exists():
            continue

        # Prevent duplicate unlock notifications.
        already_notified = NotificationLog.objects.filter(
            user=user,
            module=module,
            type=NotificationLog.NotificationType.SURVEY_PROMPT,
            status=NotificationLog.Status.SENT,
        ).exists()

        if already_notified:
            continue

        if deliver_and_log(
            user=user,
            notification_type=NotificationLog.NotificationType.SURVEY_PROMPT,
            payload_dict={
                "title": "Your survey is now available",
                "body": survey.title,
                "url": "/surveys",
            },
            module=module,
        ) == NotificationLog.Status.SENT:
            sent_any = True

    return sent_any
