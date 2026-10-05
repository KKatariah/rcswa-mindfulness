"""send_due_reminders — S20 daily meditation reminder.

Intended cron schedule (server is UTC; we fire after Perth midnight so all
users have a full day ahead):

    # Run every hour; the command filters by each user's preferred reminder_time.
    0 * * * * /path/to/venv/bin/python manage.py send_due_reminders

Due-date formula for a given user:
    cohort.start_date + timedelta(days=(module.week_number - 1) * 7 + item.day_offset)

Idempotency key: (user_id, content_item_id, perth_date) scoped to status=SENT.
A failed log entry is NOT treated as sent — it will be retried on the next run.
Running the command more than once on the same Perth day is safe for users who
have already been successfully notified; those with a FAILED log will be retried.
"""

import sys
from datetime import datetime, time as time_obj, timezone as stdlib_tz
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand
from django.utils import timezone

from app.access import survey_is_unlocked
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
from app.notifications import deliver_and_log

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
                "Check schedule completeness per active cohort: "
                "audio items with no day_offset, "
                "days with no scheduled audio item, "
                "duplicate day_offsets within a module. "
                "Exits non-zero if any issues are found."
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
        # Users without a preference row default to 8am Perth.
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

            days_in = (today - start).days
            week_number = days_in // 7 + 1
            day_offset_val = days_in % 7

            due_items = list(
                ContentItem.objects
                .filter(
                    type=ContentItem.ContentType.AUDIO,
                    day_offset=day_offset_val,
                    module__week_number=week_number,
                )
                .select_related("module")
            )

            if not due_items:
                continue

            for enr in enr_list:
                user = enr.user
                user_hour = pref_hours.get(user.id, 8)

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

                completed = completed_by_user.get(user.id, set())
                user_subs = subs_by_user.get(user.id, [])

                for item in due_items:
                    if item.id in completed:
                        skipped += 1
                        continue

                    if (user.id, item.id) in already_sent:
                        skipped += 1
                        continue

                    if dry_run:
                        channel = "push" if user_subs else "email"
                        self.stdout.write(
                            f"  [dry-run] would send ({channel}): "
                            f"user={user.email} item='{item.title}' day={today}"
                        )
                        sent += 1
                        continue

                    if deliver_and_log(
                        user=user,
                        notification_type=NotificationLog.NotificationType.CONTENT_REMINDER,
                        payload_dict={
                            "title": "Time for your daily meditation",
                            "body": item.title,
                            "url": f"/modules/{item.module_id}",
                        },
                        subject=f"Your daily meditation: {item.title}",
                        email_template="app/reminder_email.txt",
                        email_context={"user": user, "item": item, "module": item.module},
                        module=item.module,
                        content_item=item,
                        scheduled_for=scheduled_for_utc,
                        push_subs=user_subs,
                    ):
                        sent += 1
                    else:
                        errors += 1

        # ── Daily survey completion reminders ──────────────────────────────────

        # Loaded once for every user, so checking a survey needs no queries of its own.
        module_surveys = list(
            Survey.objects
            .filter(module__isnull=False)
            .select_related("module")
            .prefetch_related("module__content_items")
        )
        responded_by_user: dict[int, set[int]] = {}
        for user_id, survey_id in SurveyResponse.objects.filter(user_id__in=user_ids).values_list(
            "user_id", "survey_id"
        ):
            responded_by_user.setdefault(user_id, set()).add(survey_id)

        for enr in enrollments:
            user = enr.user
            pref = getattr(user, "notification_preference", None)

            # User must explicitly enable this reminder.
            if pref is None or not pref.daily_survey_reminder:
                continue

            # Respect the user's preferred reminder hour.
            user_hour = pref_hours.get(user.id, 8)
            if user_hour != current_hour:
                continue

            # User explicitly denied notifications.
            if pref.push_denied:
                continue

            # Unlocked surveys the user hasn't submitted yet, earliest week first.
            responded = responded_by_user.get(user.id, set())
            completed = completed_by_user.get(user.id, set())
            unlocked_surveys = [
                survey for survey in module_surveys
                if survey.pk not in responded
                and survey_is_unlocked(survey, user, completed_ids=completed, responded_ids=responded)
            ]

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

            if deliver_and_log(
                user=user,
                notification_type=NotificationLog.NotificationType.SURVEY_PROMPT,
                payload_dict={
                    "title": "Don't forget your survey",
                    "body": survey.title,
                    "url": "/surveys",
                },
                subject=f"Survey reminder: {survey.title}",
                email_template="app/survey_reminder_email.txt",
                email_context={"user": user, "survey": survey},
                module=survey.module,
                scheduled_for=scheduled_for_utc,
                push_subs=subs_by_user.get(user.id, []),
            ):
                sent += 1
            else:
                errors += 1

        self.stdout.write(
            f"[send_due_reminders] done: sent={sent} skipped={skipped} errors={errors}"
        )

    # ── --verify ───────────────────────────────────────────────────────────────

    def _verify(self):
        """
        Per active cohort: report audio items with no offset, days with no
        scheduled audio item, duplicate day_offsets. Exits non-zero if any
        issues are found.
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

                audio_items = [
                    ci for ci in module.content_items.all()
                    if ci.type == ContentItem.ContentType.AUDIO
                ]

                # Audio items with no day_offset.
                unscheduled = [ci for ci in audio_items if ci.day_offset is None]
                if unscheduled:
                    issues_found = True
                    for ci in unscheduled:
                        self.stdout.write(
                            f"  UNSCHEDULED: module='{module}' item='{ci.title}' "
                            f"(day_offset is null)"
                        )

                scheduled = [ci for ci in audio_items if ci.day_offset is not None]

                # Duplicate day_offsets within this module.
                offset_counts: dict[int, list] = {}
                for ci in scheduled:
                    offset_counts.setdefault(ci.day_offset, []).append(ci)
                for offset, items in offset_counts.items():
                    if len(items) > 1:
                        issues_found = True
                        titles = ", ".join(f"'{ci.title}'" for ci in items)
                        self.stdout.write(
                            f"  DUPLICATE OFFSET: module='{module}' day_offset={offset} "
                            f"items=[{titles}]"
                        )

                # Days 0–6 with no scheduled audio item.
                covered_offsets = {ci.day_offset for ci in scheduled}
                for day in range(7):
                    if day not in covered_offsets:
                        issues_found = True
                        self.stdout.write(
                            f"  MISSING DAY: module='{module}' day_offset={day} "
                            f"has no scheduled audio item"
                        )

        if issues_found:
            self.stderr.write(
                "\n[verify] FAIL — scheduling gaps detected (see above). "
                "Assign day_offset to all audio items before going live."
            )
            sys.exit(1)
        else:
            self.stdout.write("\n[verify] OK — all active cohorts are fully scheduled.")
