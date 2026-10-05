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

import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time as time_obj, timezone as stdlib_tz
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


def _todays_meditation(cohort, today):
    """The audio item to remind the cohort about today: the first one in this week's published
    module. None if the cohort isn't running or the week has no audio."""
    if today < cohort.start_date or today > cohort.end_date:
        return None
    return (
        ContentItem.objects
        .filter(
            type=ContentItem.ContentType.AUDIO,
            module__week_number=(today - cohort.start_date).days // 7 + 1,
            module__is_published=True,
        )
        .select_related("module")
        .order_by("display_order", "id")
        .first()
    )


@dataclass
class _Run:
    """One hourly run: its time, the data loaded once for every user, and the tallies it reports."""

    today: date
    hour: int
    scheduled_for: datetime
    dry_run: bool
    user_ids: list = field(default_factory=list)
    pref_hours: dict = field(default_factory=dict)
    completed_by_user: dict = field(default_factory=dict)
    subs_by_user: dict = field(default_factory=dict)
    # (user_id, content_item_id) pairs already SENT today; FAILED ones are retried.
    already_sent: set = field(default_factory=set)
    sent: int = 0
    skipped: int = 0
    errors: int = 0

    def load(self, user_ids):
        self.user_ids = user_ids
        for pref in NotificationPreference.objects.filter(user_id__in=user_ids).values("user_id", "reminder_time"):
            self.pref_hours[pref["user_id"]] = pref["reminder_time"].hour
        for c in ContentCompletion.objects.filter(user_id__in=user_ids).values("user_id", "content_item_id"):
            self.completed_by_user.setdefault(c["user_id"], set()).add(c["content_item_id"])
        for sub in PushSubscription.objects.filter(user_id__in=user_ids):
            self.subs_by_user.setdefault(sub.user_id, []).append(sub)
        self.already_sent = set(
            NotificationLog.objects
            .filter(
                user_id__in=user_ids,
                type=NotificationLog.NotificationType.CONTENT_REMINDER,
                scheduled_for=self.scheduled_for,
                status=NotificationLog.Status.SENT,
                content_item__isnull=False,
            )
            .values_list("user_id", "content_item_id")
        )

    def preferred_hour(self, user):
        # Users without a preference row default to 8am Perth.
        return self.pref_hours.get(user.id, 8)

    def channel_for(self, user):
        return "push" if self.subs_by_user.get(user.id) else "email"

    def record(self, delivered):
        if delivered:
            self.sent += 1
        else:
            self.errors += 1


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

        now_perth = _perth_now()
        run = _Run(
            today=now_perth.date(),
            hour=now_perth.hour,
            scheduled_for=_perth_midnight_utc(now_perth.date()),
            dry_run=options["dry_run"],
        )
        self.stdout.write(
            f"[send_due_reminders] date={run.today} hour={run.hour} (Australia/Perth) "
            f"scheduled_for={run.scheduled_for.isoformat()} dry_run={run.dry_run}"
        )

        enrollments = list(
            Enrollment.objects
            .filter(status=Enrollment.Status.ACTIVE)
            .select_related("user", "cohort", "user__notification_preference")
        )
        if not enrollments:
            self.stdout.write("[send_due_reminders] no active enrollments — done.")
            return

        run.load(list({e.user_id for e in enrollments}))
        self._send_content_reminders(run, enrollments)
        self._send_survey_reminders(run, enrollments)

        self.stdout.write(
            f"[send_due_reminders] done: sent={run.sent} skipped={run.skipped} errors={run.errors}"
        )

    # ── Daily meditation reminders ─────────────────────────────────────────────

    def _send_content_reminders(self, run, enrollments):
        """One reminder a day per user for their cohort's meditation this week."""
        by_cohort: dict[int, list] = {}
        for enr in enrollments:
            by_cohort.setdefault(enr.cohort_id, []).append(enr)

        for cohort_enrollments in by_cohort.values():
            item = _todays_meditation(cohort_enrollments[0].cohort, run.today)
            if item is None:
                continue
            for enr in cohort_enrollments:
                user = enr.user
                # Meditation is a daily practice, so this is sent every day even after
                # the student has ticked the audio off once.
                if not self._wants_content_reminder(run, user) or (user.id, item.id) in run.already_sent:
                    run.skipped += 1
                else:
                    self._remind_content(run, user, item)

    @staticmethod
    def _wants_content_reminder(run, user):
        """At this user's chosen hour, with daily reminders on and notifications not refused."""
        pref = getattr(user, "notification_preference", None)
        if run.preferred_hour(user) != run.hour:  # hourly cron: each user at their own hour
            return False
        # push_denied=True means the user explicitly refused — no push, no email.
        return not (pref and (not pref.daily_content_reminder or pref.push_denied))

    def _remind_content(self, run, user, item):
        if run.dry_run:
            self.stdout.write(
                f"  [dry-run] would send ({run.channel_for(user)}): "
                f"user={user.email} item='{item.title}' day={run.today}"
            )
            run.sent += 1
            return
        run.record(deliver_and_log(
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
            scheduled_for=run.scheduled_for,
            push_subs=run.subs_by_user.get(user.id, []),
        ))

    # ── Daily survey completion reminders ──────────────────────────────────────

    def _send_survey_reminders(self, run, enrollments):
        """At most one reminder per user per day, for their earliest unlocked, unanswered survey."""
        # Loaded once for every user, so checking a survey needs no queries of its own.
        module_surveys = list(
            Survey.objects
            .filter(module__isnull=False)
            .select_related("module")
            .prefetch_related("module__content_items")
        )
        responded_by_user: dict[int, set[int]] = {}
        for user_id, survey_id in SurveyResponse.objects.filter(user_id__in=run.user_ids).values_list(
            "user_id", "survey_id"
        ):
            responded_by_user.setdefault(user_id, set()).add(survey_id)

        for enr in enrollments:
            user = enr.user
            pref = getattr(user, "notification_preference", None)
            # Opt-in only; at the user's hour; never if they refused notifications.
            if pref is None or not pref.daily_survey_reminder or run.preferred_hour(user) != run.hour or pref.push_denied:
                continue

            responded = responded_by_user.get(user.id, set())
            completed = run.completed_by_user.get(user.id, set())
            survey = next(
                (
                    s for s in module_surveys
                    if s.pk not in responded
                    and survey_is_unlocked(s, user, completed_ids=completed, responded_ids=responded)
                ),
                None,
            )
            if survey is None:
                continue

            if NotificationLog.objects.filter(
                user=user,
                type=NotificationLog.NotificationType.SURVEY_PROMPT,
                scheduled_for=run.scheduled_for,
                status=NotificationLog.Status.SENT,
            ).exists():
                run.skipped += 1
                continue

            self._remind_survey(run, user, survey)

    def _remind_survey(self, run, user, survey):
        if run.dry_run:
            self.stdout.write(
                f"  [dry-run] would send survey reminder ({run.channel_for(user)}): "
                f"user={user.email} survey='{survey.title}' day={run.today}"
            )
            run.sent += 1
            return
        run.record(deliver_and_log(
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
            scheduled_for=run.scheduled_for,
            push_subs=run.subs_by_user.get(user.id, []),
        ))

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
                if module.week_number < 1:
                    continue  # the week 0 introduction gets no daily reminders

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
