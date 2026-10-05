"""send_due_reminders — S20 daily meditation reminder.

Intended cron schedule (server is UTC; we fire after Perth midnight so all
users have a full day ahead):

    # Run every hour; the command filters by each user's preferred reminder_time.
    0 * * * * /path/to/venv/bin/python manage.py send_due_reminders

Every day a cohort is running, each active student gets one reminder for the
current week's meditation: the first audio item (by display order) in the
published module for that week, where the week is counted from cohort.start_date.

Idempotency key: (user_id, content_item_id, perth_date) scoped to status=SENT.
A failed log entry is NOT treated as sent — it will be retried on the next run.
Running the command more than once on the same Perth day is safe for users who
have already been successfully notified; those with a FAILED log will be retried.
"""

import json
import sys
from datetime import datetime, time as time_obj, timezone as stdlib_tz
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand
from django.template.loader import render_to_string
from django.utils import timezone

from app.serializers import module_is_unlocked
from app.models import (
    Cohort,
    ContentItem,
    ContentCompletion,
    Enrollment,
    Module,
    NotificationLog,
    NotificationPreference,
    PushSubscription,
    Survey,
    SurveyResponse,
)

PERTH_TZ = ZoneInfo("Australia/Perth")
UTC = stdlib_tz.utc


def _perth_now():
    return timezone.now().astimezone(PERTH_TZ)


def _perth_today():
    return _perth_now().date()


def _perth_midnight_utc(date):
    return datetime.combine(date, time_obj.min, tzinfo=PERTH_TZ).astimezone(UTC)


class Command(BaseCommand):
    help = (
        "Send daily meditation reminders (S20). "
        "Safe to run on an hourly cron — users are filtered by their reminder_time hour. "
        "Idempotent per (user, item, date) for successful sends; failed sends are retried. "
        "Use --verify to check for scheduling gaps without sending anything."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be sent without sending or writing logs.",
        )
        parser.add_argument(
            "--verify",
            action="store_true",
            help=(
                "Check every published week of each active cohort has an audio "
                "item to remind about. Exits non-zero if any are missing."
            ),
        )

    def handle(self, *args, **options):
        if options["verify"]:
            self._verify()
            return

        dry_run = options["dry_run"]
        now_perth = _perth_now()
        today = now_perth.date()
        current_hour = now_perth.hour
        scheduled_for_utc = _perth_midnight_utc(today)

        self.stdout.write(
            f"[send_due_reminders] date={today} hour={current_hour} (Australia/Perth) "
            f"scheduled_for={scheduled_for_utc.isoformat()} dry_run={dry_run}"
        )

        sent = skipped = errors = 0

        # ── Active enrollments ─────────────────────────────────────────────────

        enrollments = list(
            Enrollment.objects
            .filter(status=Enrollment.Status.ACTIVE)
            .select_related("user", "cohort", "user__notification_preference")
        )

        if not enrollments:
            self.stdout.write("[send_due_reminders] no active enrollments — done.")
            return

        user_ids = list({e.user_id for e in enrollments})

        # ── Per-user preference hour lookup ────────────────────────────────────
        # Users without a preference row default to 5pm Perth.
        pref_hours: dict[int, int] = {}
        for pref in NotificationPreference.objects.filter(user_id__in=user_ids).values(
            "user_id", "reminder_time"
        ):
            pref_hours[pref["user_id"]] = pref["reminder_time"].hour

        # ── Pre-fetch completed item IDs per user ──────────────────────────────

        completed_by_user: dict[int, set[int]] = {}
        for c in ContentCompletion.objects.filter(user_id__in=user_ids).values(
            "user_id", "content_item_id"
        ):
            completed_by_user.setdefault(c["user_id"], set()).add(c["content_item_id"])

        # ── Pre-fetch push subscriptions per user ──────────────────────────────

        subs_by_user: dict[int, list] = {}
        for sub in PushSubscription.objects.filter(user_id__in=user_ids):
            subs_by_user.setdefault(sub.user_id, []).append(sub)

        # ── Idempotency: pairs already SENT today (failed = retryable) ─────────

        already_sent: set[tuple[int, int]] = set(
            NotificationLog.objects
            .filter(
                user_id__in=user_ids,
                type=NotificationLog.NotificationType.CONTENT_REMINDER,
                scheduled_for=scheduled_for_utc,
                status=NotificationLog.Status.SENT,
                content_item__isnull=False,
            )
            .values_list("user_id", "content_item_id")
        )

        # ── Group enrollments by cohort ────────────────────────────────────────

        cohort_groups: dict[int, list] = {}
        for enr in enrollments:
            cohort_groups.setdefault(enr.cohort_id, []).append(enr)

        for cohort_id, enr_list in cohort_groups.items():
            cohort = enr_list[0].cohort
            start = cohort.start_date
            end = cohort.end_date

            if today < start or today > end:
                continue

            week_number = (today - start).days // 7 + 1

            # One reminder a day: the week's meditation, whichever day of the week it is.
            item = (
                ContentItem.objects
                .filter(
                    type=ContentItem.ContentType.AUDIO,
                    module__week_number=week_number,
                    module__is_published=True,
                )
                .select_related("module")
                .order_by("display_order", "id")
                .first()
            )

            if item is None:
                continue

            for enr in enr_list:
                user = enr.user
                user_hour = pref_hours.get(user.id, 17)

                # Hourly cron support: only fire for users whose preferred hour matches.
                if user_hour != current_hour:
                    skipped += 1
                    continue

                pref = getattr(user, "notification_preference", None)

                # Respect the user's daily content reminder preference.
                if pref and not pref.daily_content_reminder:
                    skipped += 1
                    continue

                # push_denied=True means the user explicitly refused — no push, no email.
                if pref and pref.push_denied:
                    skipped += 1
                    continue

                # Meditation is a daily practice, so this is sent every day even after
                # the student has ticked the audio off once.
                if (user.id, item.id) in already_sent:
                    skipped += 1
                    continue

                user_subs = subs_by_user.get(user.id, [])

                if dry_run:
                    channel = "push" if user_subs else "email"
                    self.stdout.write(
                        f"  [dry-run] would send ({channel}): "
                        f"user={user.email} item='{item.title}' day={today}"
                    )
                    sent += 1
                    continue

                channel = self._send(user, item, user_subs, pref)
                log_status = (
                    NotificationLog.Status.SENT if channel else NotificationLog.Status.FAILED
                )
                log_channel = channel or NotificationLog.Channel.PUSH

                NotificationLog.objects.create(
                    user=user,
                    type=NotificationLog.NotificationType.CONTENT_REMINDER,
                    content_item=item,
                    module=item.module,
                    channel=log_channel,
                    scheduled_for=scheduled_for_utc,
                    sent_at=timezone.now() if channel else None,
                    status=log_status,
                )

                if channel:
                    sent += 1
                else:
                    errors += 1

                # ── Daily survey completion reminders ────────────────────────────────

        for enr in enrollments:
            user = enr.user
            pref = getattr(user, "notification_preference", None)

            # User must explicitly enable this reminder.
            if pref is None or not pref.daily_survey_reminder:
                continue

            # Respect the user's preferred reminder hour.
            user_hour = pref_hours.get(user.id, 17)
            if user_hour != current_hour:
                continue

            # User explicitly denied notifications.
            if pref.push_denied:
                continue

            # Only consider surveys that have not already been submitted.
            responded_survey_ids = set(
                SurveyResponse.objects.filter(
                    user=user
                ).values_list("survey_id", flat=True)
            )

            surveys = (
                Survey.objects
                .filter(module__isnull=False)
                .exclude(id__in=responded_survey_ids)
                .select_related("module")
            )

            unlocked_surveys = []

            completed = completed_by_user.get(user.id, set())

            for survey in surveys:
                module = survey.module

                # Module must already be available to this user.
                if not module_is_unlocked(module, user):
                    continue

                required_ids = set(
                    ContentItem.objects.filter(
                        module=module
                    ).values_list("id", flat=True)
                )

                # Match the existing survey unlock rule.
                if required_ids and not required_ids.issubset(completed):
                    continue

                unlocked_surveys.append(survey)

            if not unlocked_surveys:
                continue

            # Only one daily survey reminder per user per day.
            already_reminded = NotificationLog.objects.filter(
                user=user,
                type=NotificationLog.NotificationType.SURVEY_PROMPT,
                scheduled_for=scheduled_for_utc,
                status=NotificationLog.Status.SENT,
            ).exists()

            if already_reminded:
                skipped += 1
                continue

            survey = unlocked_surveys[0]

            if dry_run:
                channel = "push" if subs_by_user.get(user.id) else "email"
                self.stdout.write(
                    f"  [dry-run] would send survey reminder ({channel}): "
                    f"user={user.email} survey='{survey.title}' day={today}"
                )
                sent += 1
                continue

            channel = self._send_survey_reminder(
                user,
                survey,
                subs_by_user.get(user.id, []),
                pref,
            )

            NotificationLog.objects.create(
                user=user,
                type=NotificationLog.NotificationType.SURVEY_PROMPT,
                module=survey.module,
                channel=channel or NotificationLog.Channel.PUSH,
                scheduled_for=scheduled_for_utc,
                sent_at=timezone.now() if channel else None,
                status=(
                    NotificationLog.Status.SENT
                    if channel
                    else NotificationLog.Status.FAILED
                ),
            )

            if channel:
                sent += 1
            else:
                errors += 1

        self.stdout.write(
            f"[send_due_reminders] done: sent={sent} skipped={skipped} errors={errors}"
        )

    # ── Delivery helpers ───────────────────────────────────────────────────────
    def _send_survey_reminder(self, user, survey, push_subs, pref):
        """Send a reminder for an unlocked but incomplete survey."""

        if push_subs:
            try:
                from pywebpush import webpush, WebPushException
            except ImportError:
                WebPushException = Exception
                webpush = None

            if webpush and settings.VAPID_PRIVATE_KEY:
                payload = json.dumps({
                    "title": "Don't forget your survey",
                    "body": survey.title,
                    "url": "/surveys",
                })

                sent_any = False

                for sub in list(push_subs):
                    try:
                        webpush(
                            subscription_info={
                                "endpoint": sub.endpoint,
                                "keys": {
                                    "p256dh": sub.p256dh,
                                    "auth": sub.auth,
                                },
                            },
                            data=payload,
                            vapid_private_key=settings.VAPID_PRIVATE_KEY,
                            vapid_claims={
                                "sub": f"mailto:{settings.VAPID_ADMIN_EMAIL}"
                            },
                            content_encoding="aes128gcm",
                        )
                        sent_any = True

                    except WebPushException as exc:
                        resp = getattr(exc, "response", None)

                        if resp is not None and resp.status_code in (404, 410):
                            sub.delete()
                        else:
                            self.stderr.write(
                                f"    survey push failed for {user.email}: {exc}"
                            )

                if sent_any:
                    return NotificationLog.Channel.PUSH

        # Fall back to email.
        if pref is None or pref.email_enabled:
            try:
                send_mail(
                    subject=f"Survey reminder: {survey.title}",
                    message=(
                        f"Hi {user.full_name},\n\n"
                        f"Your survey '{survey.title}' is ready to complete.\n\n"
                        "Please log in to the mindfulness program to complete it."
                    ),
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[user.email],
                    fail_silently=False,
                )

                return NotificationLog.Channel.EMAIL

            except Exception as exc:
                self.stderr.write(
                    f"    survey email failed for {user.email}: {exc}"
                )

        return None

    def _send(self, user, item, push_subs, pref):
        """Attempt push, fall back to email if push_denied is False. Returns channel or None."""
        if push_subs:
            channel = self._send_push(user, item, push_subs)
            if channel:
                return channel

        if pref is None or pref.email_enabled:
            return self._send_email(user, item)

        return None

    def _send_push(self, user, item, push_subs):
        try:
            from pywebpush import webpush, WebPushException
        except ImportError:
            self.stderr.write("pywebpush is not installed — push skipped.")
            return None

        if not settings.VAPID_PRIVATE_KEY:
            self.stderr.write("VAPID_PRIVATE_KEY not configured — push skipped.")
            return None

        payload = json.dumps({
            "title": "Time for your daily meditation",
            "body": item.title,
            "url": f"/modules/{item.module.week_number}/",
        })

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
                    self.stderr.write(
                        f"    pruned dead endpoint for {user.email}: {sub.endpoint[:70]}…"
                    )
                else:
                    self.stderr.write(f"    push failed for {user.email}: {exc}")
            except Exception as exc:
                self.stderr.write(f"    push error for {user.email}: {exc}")

        return NotificationLog.Channel.PUSH if sent_any else None

    def _send_email(self, user, item):
        try:
            body = render_to_string(
                "app/reminder_email.txt",
                {"user": user, "item": item, "module": item.module},
            )
            send_mail(
                subject=f"Your daily meditation: {item.title}",
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=False,
            )
            return NotificationLog.Channel.EMAIL
        except Exception as exc:
            self.stderr.write(f"    email failed for {user.email}: {exc}")
            return None

    # ── --verify ───────────────────────────────────────────────────────────────

    def _verify(self):
        """
        Per active cohort: report published weeks with no audio item, since those
        days would go without a meditation reminder. Exits non-zero if any are found.
        """
        today = _perth_today()
        issues_found = False

        active_cohorts = Cohort.objects.filter(
            end_date__gte=today,
            enrollments__status=Enrollment.Status.ACTIVE,
        ).distinct()

        if not active_cohorts.exists():
            self.stdout.write("[verify] no active cohorts.")
            return

        # Published modules are shared across all cohorts (global schedule).
        published_modules = list(
            Module.objects.filter(is_published=True).prefetch_related("content_items")
        )

        for cohort in active_cohorts:
            self.stdout.write(f"\n=== Cohort: {cohort} ===")
            weeks_in_program = (cohort.end_date - cohort.start_date).days // 7 + 1

            for module in published_modules:
                if module.week_number > weeks_in_program:
                    continue  # module is beyond this cohort's duration

                has_audio = any(
                    ci.type == ContentItem.ContentType.AUDIO for ci in module.content_items.all()
                )
                if not has_audio:
                    issues_found = True
                    self.stdout.write(
                        f"  NO MEDITATION: module='{module}' has no audio item, "
                        f"so no daily reminders will be sent that week"
                    )

        if issues_found:
            self.stderr.write(
                "\n[verify] FAIL — weeks without a meditation (see above). "
                "Add an audio item to each before going live."
            )
            sys.exit(1)
        else:
            self.stdout.write("\n[verify] OK — every published week has a meditation.")
