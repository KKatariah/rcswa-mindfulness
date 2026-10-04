"""Notification service layer.

Delivery helpers used by both the management command and the S21 signal handler.
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
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils import timezone

from .serializers import module_is_unlocked
from .models import (
    Enrollment,
    NotificationLog,
    NotificationPreference,
    PushSubscription,
)

logger = logging.getLogger(__name__)

# No reminder fires within this many minutes of a previous one for the same module.
CONTENT_UPDATE_DEBOUNCE_MINUTES = 60


def _get_pref(user):
    """Return the user's NotificationPreference or a safe default object."""
    try:
        return user.notification_preference
    except NotificationPreference.DoesNotExist:
        return None


def send_push(user, payload_dict, push_subs):
    """
    Attempt to deliver a push notification to all of the user's registered
    endpoints. Prunes endpoints that return 404 or 410 (gone).

    Returns NotificationLog.Channel.PUSH if at least one delivery succeeded,
    otherwise None.
    """
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush not installed — push skipped for %s", user.email)
        return None

    if not settings.VAPID_PRIVATE_KEY:
        logger.warning("VAPID_PRIVATE_KEY not configured — push skipped")
        return None

    payload = json.dumps(payload_dict)
    sent_any = False

    for sub in list(push_subs):
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
                logger.info("Pruned dead push endpoint for %s", user.email)
            else:
                logger.warning("Push failed for %s: %s", user.email, exc)
        except Exception as exc:
            logger.warning("Push error for %s: %s", user.email, exc)

    return NotificationLog.Channel.PUSH if sent_any else None


def send_email_notification(user, subject, template, context):
    """
    Render *template* with *context* and send to the user's email address.
    Returns NotificationLog.Channel.EMAIL on success, None on failure.
    """
    try:
        body = render_to_string(template, context)
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
        return NotificationLog.Channel.EMAIL
    except Exception as exc:
        logger.warning("Email failed for %s: %s", user.email, exc)
        return None


def deliver(user, payload_dict, subject, email_template, email_context):
    """
    Deliver a notification to *user* via push (primary) or email (fallback).

    Push-denied semantics:
        push_denied=True  → skip entirely (user explicitly refused)
        No subscription   → email fallback (user hasn't subscribed yet)
        Push broken       → email fallback (404/410 pruned; other errors)

    Returns (channel, success) where channel is the Channel used or None.
    """
    pref = _get_pref(user)

    if pref and pref.push_denied:
        return None, False

    push_subs = list(PushSubscription.objects.filter(user=user))
    if push_subs:
        channel = send_push(user, payload_dict, push_subs)
        if channel:
            return channel, True

    # Fall back to email only if push permission hasn't been explicitly denied.
    if pref is None or pref.email_enabled:
        channel = send_email_notification(user, subject, email_template, email_context)
        return channel, channel is not None

    return None, False


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

    from zoneinfo import ZoneInfo
    PERTH_TZ = ZoneInfo("Australia/Perth")
    today = timezone.now().astimezone(PERTH_TZ).date()

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

        payload = {
            "title": f"New content: Week {module.week_number}",
            "body": module.title,
            "url": f"/modules/{module.week_number}/",
        }
        channel, success = deliver(
            user=user,
            payload_dict=payload,
            subject=f"New mindfulness content: {module.title}",
            email_template="app/content_update_email.txt",
            email_context={"user": user, "module": module},
        )
        log_status = (
            NotificationLog.Status.SENT if success else NotificationLog.Status.FAILED
        )
        NotificationLog.objects.create(
            user=user,
            type=NotificationLog.NotificationType.CONTENT_UPDATE,
            module=module,
            channel=channel or NotificationLog.Channel.PUSH,
            scheduled_for=scheduled_for,
            sent_at=scheduled_for if success else None,
            status=log_status,
        )
        if success:
            sent += 1

    logger.info("S21 content-update: module=%s sent=%d", module, sent)


def notify_survey_unlocked(user, module):
    """
    Notify a user when completing all content in a module
    unlocks its weekly survey.
    """
    from .models import (
        ContentCompletion,
        ContentItem,
        NotificationLog,
        Survey,
        SurveyResponse,
    )

    pref = _get_pref(user)

    # User disabled the "survey unlocked" notification.
    if pref is None or not pref.survey_unlocked_reminder:
        return False

    # Module itself must already be available to this user.
    if not module_is_unlocked(module, user):
        return False

    # The survey unlock rule must match serializers.py:
    # every ContentItem in this module must be completed.
    required_ids = set(
        ContentItem.objects.filter(
            module=module
        ).values_list("id", flat=True)
    )

    if not required_ids:
        return False

    completed_ids = set(
        ContentCompletion.objects.filter(
            user=user,
            content_item_id__in=required_ids,
        ).values_list("content_item_id", flat=True)
    )

    if required_ids != completed_ids:
        return False

    surveys = Survey.objects.filter(
        module=module,
        type=Survey.SurveyType.WEEKLY,
    )

    sent_any = False

    for survey in surveys:
        # No need to notify if the user already submitted it.
        if SurveyResponse.objects.filter(
            user=user,
            survey=survey,
        ).exists():
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

        payload = {
            "title": "Your survey is now available",
            "body": survey.title,
            "url": "/surveys",
        }

        now = timezone.now()

        channel, success = deliver(
            user=user,
            payload_dict=payload,
            subject=f"Survey available: {survey.title}",
            email_template="app/content_update_email.txt",
            email_context={
                "user": user,
                "module": module,
            },
        )

        NotificationLog.objects.create(
            user=user,
            type=NotificationLog.NotificationType.SURVEY_PROMPT,
            module=module,
            channel=channel or NotificationLog.Channel.PUSH,
            scheduled_for=now,
            sent_at=now if success else None,
            status=(
                NotificationLog.Status.SENT
                if success
                else NotificationLog.Status.FAILED
            ),
        )

        if success:
            sent_any = True

    return sent_any
