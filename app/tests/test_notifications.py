"""Push subscriptions, delivery, and the daily reminder and unlock notifications."""

import datetime
import json
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework import status

from ..models import (
    Cohort,
    ContentCompletion,
    ContentItem,
    Enrollment,
    Module,
    NotificationLog,
    NotificationPreference,
    PushSubscription,
    Survey,
    SurveyResponse,
    SurveyType,
)
from .base import (
    User,
    TestCase,
    APITestCase,
    _enroll,
    _make_user,
    _make_cohort,
    _make_module,
    _make_audio_item,
    _perth_midnight_utc,
    _cohort,
    _pushed_titles,
)


class PushSubscriptionEndpointReuseTests(APITestCase):
    """T1: registering the same push endpoint under a different user reassigns it."""

    def setUp(self):
        self.user_a = _make_user("a@test.local")
        self.user_b = _make_user("b@test.local")
        _enroll(self.user_a, self.user_b)

    def test_endpoint_reassigned_to_new_user(self):
        payload = {"endpoint": "https://push.example.com/sub/123", "p256dh": "key", "auth": "auth"}

        self.client.force_authenticate(user=self.user_a)
        resp_a = self.client.post("/api/notifications/subscriptions/", payload)
        self.assertIn(resp_a.status_code, [status.HTTP_200_OK, status.HTTP_201_CREATED])

        sub_id = resp_a.data["id"]
        self.assertEqual(PushSubscription.objects.get(pk=sub_id).user_id, self.user_a.pk)

        self.client.force_authenticate(user=self.user_b)
        resp_b = self.client.post("/api/notifications/subscriptions/", payload)
        self.assertIn(resp_b.status_code, [status.HTTP_200_OK, status.HTTP_201_CREATED])

        # Endpoint is unique — exactly one row exists and it now belongs to user B.
        self.assertEqual(PushSubscription.objects.filter(endpoint=payload["endpoint"]).count(), 1)
        sub = PushSubscription.objects.get(endpoint=payload["endpoint"])
        self.assertEqual(sub.user_id, self.user_b.pk)


@override_settings(VAPID_PRIVATE_KEY="test-key")
class DeliverySkipTests(TestCase):
    """T2: nothing is sent, and the attempt is logged as SKIPPED, when there is nowhere to send it."""

    def test_deliver_skips_when_push_denied(self):
        from app.notifications import deliver
        user = _make_user("denied@test.local")
        NotificationPreference.objects.create(user=user, push_denied=True)
        PushSubscription.objects.create(user=user, endpoint="https://push.example/a", p256dh="k", auth="a")

        with patch("pywebpush.webpush") as mock_push:
            result = deliver(user=user, payload_dict={"title": "test"})

        self.assertEqual(result, NotificationLog.Status.SKIPPED)
        mock_push.assert_not_called()

    def test_user_without_a_device_is_logged_as_skipped(self):
        from app.notifications import deliver_and_log
        user = _make_user("nodevice@test.local")

        result = deliver_and_log(
            user=user, notification_type=NotificationLog.NotificationType.CONTENT_UPDATE, payload_dict={"title": "t"},
        )

        self.assertEqual(result, NotificationLog.Status.SKIPPED)
        log = NotificationLog.objects.get(user=user)
        self.assertEqual((log.status, log.sent_at), (NotificationLog.Status.SKIPPED, None))


class FailedSendRetriesNextRunTests(TestCase):
    """T3: a FAILED NotificationLog entry does not block the next run."""

    def setUp(self):
        self.user = _make_user("retry@test.local")
        # reminder_time defaults to 17:00 Perth — the mock will set current hour to 17
        self.cohort = _make_cohort(days_ago=0, duration=56)
        Enrollment.objects.create(user=self.user, cohort=self.cohort)
        self.module = _make_module(week=1)
        self.item = _make_audio_item(self.module)

        today = datetime.date.today()
        scheduled_for = _perth_midnight_utc(today)

        NotificationLog.objects.create(
            user=self.user,
            type=NotificationLog.NotificationType.CONTENT_REMINDER,
            content_item=self.item,
            module=self.module,
            channel=NotificationLog.Channel.PUSH,
            scheduled_for=scheduled_for,
            status=NotificationLog.Status.FAILED,
        )

    def test_failed_log_does_not_prevent_retry(self):
        from zoneinfo import ZoneInfo
        PERTH_TZ = ZoneInfo("Australia/Perth")
        fake_now = datetime.datetime.combine(
            datetime.date.today(), datetime.time(17, 0), tzinfo=PERTH_TZ
        )

        with patch("app.management.commands.send_due_reminders._perth_now", return_value=fake_now):
            out = StringIO()
            call_command("send_due_reminders", "--dry-run", stdout=out)

        output = out.getvalue()
        self.assertIn("dry-run", output)
        self.assertIn(self.user.email, output)


class PerthDateBoundaryTests(TestCase):
    """T4: scheduled_for stores Perth midnight in UTC (i.e. 16:00 UTC previous day)."""

    def test_perth_midnight_is_16_hours_behind_utc(self):
        perth_date = datetime.date(2024, 6, 15)
        expected_utc = datetime.datetime(2024, 6, 14, 16, 0, 0, tzinfo=datetime.timezone.utc)
        actual = _perth_midnight_utc(perth_date)
        self.assertEqual(actual, expected_utc)

    def test_idempotency_key_uses_perth_date_not_utc_date(self):
        """A notification sent at 23:30 UTC (07:30 Perth next day) stores the Perth date."""
        from zoneinfo import ZoneInfo
        PERTH_TZ = ZoneInfo("Australia/Perth")
        # 2024-06-14 23:30 UTC = 2024-06-15 07:30 Perth
        utc_time = datetime.datetime(2024, 6, 14, 23, 30, 0, tzinfo=datetime.timezone.utc)
        perth_date = utc_time.astimezone(PERTH_TZ).date()
        scheduled_for = _perth_midnight_utc(perth_date)

        self.assertEqual(perth_date, datetime.date(2024, 6, 15))
        self.assertEqual(scheduled_for, datetime.datetime(2024, 6, 14, 16, 0, 0, tzinfo=datetime.timezone.utc))


class VerifyMissingMeditationTests(TestCase):
    """T5: --verify exits non-zero when a published week has no audio item to remind about."""

    def setUp(self):
        self.user = _make_user("verify@test.local")
        cohort = _make_cohort(days_ago=7, duration=56)
        Enrollment.objects.create(user=self.user, cohort=cohort, status=Enrollment.Status.ACTIVE)
        self.module = _make_module(week=1)
        ContentItem.objects.create(
            module=self.module, title="Talk", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/x", display_order=1,
        )

    def test_verify_exits_nonzero_for_week_without_audio(self):
        with self.assertRaises(SystemExit) as ctx:
            call_command("send_due_reminders", "--verify", stderr=StringIO(), stdout=StringIO())
        self.assertNotEqual(ctx.exception.code, 0)

    def test_verify_passes_once_week_has_audio(self):
        _make_audio_item(self.module)
        out = StringIO()
        call_command("send_due_reminders", "--verify", stderr=StringIO(), stdout=out)
        self.assertIn("OK", out.getvalue())


class DailyMeditationReminderTests(TestCase):
    """Every day of a running week sends exactly one meditation reminder per student."""

    def setUp(self):
        self.user = _make_user("daily@test.local")
        # Day 4 of week 1, so a reminder must not depend on it being the week's first day.
        self.cohort = _make_cohort(days_ago=3, duration=56)
        Enrollment.objects.create(user=self.user, cohort=self.cohort)
        self.module = _make_module(week=1)
        self.first = _make_audio_item(self.module, title="Body Scan", display_order=1)
        self.second = _make_audio_item(self.module, title="Breathing", display_order=2)

    def _run(self):
        from zoneinfo import ZoneInfo
        fake_now = datetime.datetime.combine(
            datetime.date.today(), datetime.time(17, 0), tzinfo=ZoneInfo("Australia/Perth")
        )
        out = StringIO()
        with patch("app.management.commands.send_due_reminders._perth_now", return_value=fake_now):
            call_command("send_due_reminders", "--dry-run", stdout=out)
        return [line for line in out.getvalue().splitlines() if "[dry-run]" in line]

    def test_one_reminder_on_any_day_of_the_week(self):
        lines = self._run()
        self.assertEqual(len(lines), 1)
        self.assertIn("Body Scan", lines[0])

    def test_still_reminded_after_completing_the_audio(self):
        ContentCompletion.objects.create(user=self.user, content_item=self.first)
        self.assertEqual(len(self._run()), 1)

    def test_no_reminder_for_unpublished_week(self):
        self.module.is_published = False
        self.module.save()
        self.assertEqual(self._run(), [])


class S21NotifiesOnlyActiveCohortTests(TestCase):
    """T6: notify_content_update sends only to ACTIVE enrollments in running cohorts."""

    def setUp(self):
        self.active_user = _make_user("active@test.local")
        self.ended_user = _make_user("ended@test.local")

        today = datetime.date.today()
        active_cohort = Cohort.objects.create(
            name="Active", year=today.year,
            start_date=today - datetime.timedelta(days=7),
            end_date=today + datetime.timedelta(days=49),
        )
        ended_cohort = Cohort.objects.create(
            name="Ended", year=today.year - 1,
            start_date=today - datetime.timedelta(days=365),
            end_date=today - datetime.timedelta(days=300),
        )

        Enrollment.objects.create(user=self.active_user, cohort=active_cohort, status=Enrollment.Status.ACTIVE)
        Enrollment.objects.create(user=self.ended_user, cohort=ended_cohort, status=Enrollment.Status.ACTIVE)

        self.module = _make_module(week=1)

    def test_only_active_cohort_users_notified(self):
        from app.notifications import notify_content_update
        notify_content_update(module=self.module)

        logs = NotificationLog.objects.filter(
            type=NotificationLog.NotificationType.CONTENT_UPDATE
        )
        notified_user_ids = set(logs.values_list("user_id", flat=True))
        self.assertIn(self.active_user.pk, notified_user_ids)
        self.assertNotIn(self.ended_user.pk, notified_user_ids)

    def test_users_with_module_still_locked_not_notified(self):
        # Active cohort started 7 days ago, so week 3 opens in 7 days.
        locked_module = _make_module(week=3)
        from app.notifications import notify_content_update
        notify_content_update(module=locked_module)

        self.assertFalse(
            NotificationLog.objects.filter(
                type=NotificationLog.NotificationType.CONTENT_UPDATE,
                user=self.active_user,
            ).exists()
        )


class UnlockNotificationEdgeCaseTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="s@test.local", password="testpass")
        with patch("app.signals._fire_async"):
            for week in range(1, 11):
                Module.objects.create(week_number=week, title=f"W{week}", is_published=True)

    def _run(self):
        out = StringIO()
        call_command("send_module_unlock_notifications", stdout=out)
        return NotificationLog.objects.filter(user=self.user, type=NotificationLog.NotificationType.MODULE_ADDED)

    def test_week_after_cohort_end_is_not_announced(self):
        # 8-week cohort; week 10 opens 63 days after the start, after the end date.
        cohort = _cohort(63, length_days=56)
        Enrollment.objects.create(user=self.user, cohort=cohort)
        self.assertEqual(self._run().count(), 0)

    def test_approved_mid_cohort_gets_only_todays_week(self):
        # Week 5 opens today; weeks 1-4 are already open but must not all be announced.
        cohort = _cohort(28)
        Enrollment.objects.create(user=self.user, cohort=cohort)
        self.assertEqual([log.module.week_number for log in self._run()], [5])

    def test_unlock_follows_perth_midnight(self):
        import datetime as dt
        from django.utils import timezone
        from ..serializers import module_is_unlocked
        cohort = _cohort(0)
        Enrollment.objects.create(user=self.user, cohort=cohort)
        week2 = Module.objects.get(week_number=2)
        unlock_day = cohort.start_date + timedelta(days=7)
        perth_midnight_utc = dt.datetime.combine(unlock_day, dt.time.min, tzinfo=dt.timezone.utc) - timedelta(hours=8)
        for offset, expected in ((timedelta(minutes=-1), False), (timedelta(0), True)):
            user = User.objects.get(pk=self.user.pk)  # fresh instance: cohort start is cached per user
            with patch("django.utils.timezone.now", return_value=perth_midnight_utc + offset):
                self.assertEqual(module_is_unlocked(week2, user), expected, offset)
                self.assertEqual(timezone.localdate(), unlock_day if expected else unlock_day - timedelta(days=1))


@override_settings(VAPID_PRIVATE_KEY="test-key")
class PushFailureTests(TestCase):
    def test_expired_subscription_is_removed_and_send_fails(self):
        from pywebpush import WebPushException
        from ..notifications import deliver
        user = User.objects.create_user(email="s@test.local", password="testpass")
        PushSubscription.objects.create(user=user, endpoint="https://push.example/gone", p256dh="k", auth="a")
        gone = WebPushException("gone", response=type("R", (), {"status_code": 410})())
        with patch("pywebpush.webpush", side_effect=gone):
            result = deliver(user=user, payload_dict={"title": "t"})
        self.assertEqual(result, NotificationLog.Status.FAILED)
        self.assertFalse(PushSubscription.objects.filter(user=user).exists())

    def test_one_working_device_is_enough(self):
        from pywebpush import WebPushException
        from ..notifications import deliver
        user = User.objects.create_user(email="s@test.local", password="testpass")
        PushSubscription.objects.create(user=user, endpoint="https://push.example/gone", p256dh="k", auth="a")
        PushSubscription.objects.create(user=user, endpoint="https://push.example/ok", p256dh="k", auth="a")
        gone = WebPushException("gone", response=type("R", (), {"status_code": 410})())

        def webpush(subscription_info, **kwargs):
            if subscription_info["endpoint"].endswith("gone"):
                raise gone

        with patch("pywebpush.webpush", side_effect=webpush):
            self.assertEqual(deliver(user=user, payload_dict={"title": "t"}), NotificationLog.Status.SENT)
        self.assertEqual(list(PushSubscription.objects.values_list("endpoint", flat=True)), ["https://push.example/ok"])


class ReminderTimeTests(APITestCase):
    def test_reminder_time_must_be_on_the_hour(self):
        user = User.objects.create_user(email="s@test.local", password="testpass")
        _enroll(user)
        self.client.force_login(user)
        bad = self.client.patch("/api/notifications/preferences/me/", {"reminder_time": "08:30"}, format="json")
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        ok = self.client.patch("/api/notifications/preferences/me/", {"reminder_time": "19:00"}, format="json")
        self.assertEqual(ok.status_code, status.HTTP_200_OK)


@override_settings(VAPID_PRIVATE_KEY="test-key")
class ReminderDeliveryTests(TestCase):
    """Real (non dry-run) sends from send_due_reminders and notify_survey_unlocked."""

    def setUp(self):
        from django.utils import timezone
        from zoneinfo import ZoneInfo
        self.user = _make_user("remind@test.local")
        today = timezone.localdate()
        cohort = Cohort.objects.create(
            name="Now", year=today.year, start_date=today, end_date=today + timedelta(days=56)
        )
        Enrollment.objects.create(user=self.user, cohort=cohort)
        with patch("app.signals._fire_async"):
            self.module = _make_module(week=1)
            self.item = _make_audio_item(self.module, title="Body scan")
        # 17:00 Perth: the default reminder hour.
        self.fake_now = datetime.datetime.combine(today, datetime.time(17, 0), tzinfo=ZoneInfo("Australia/Perth"))
        PushSubscription.objects.create(user=self.user, endpoint="https://push.example/a", p256dh="k", auth="a")
        push_patch = patch("pywebpush.webpush")
        self.push = push_patch.start()
        self.addCleanup(push_patch.stop)

    def _run(self):
        with patch("app.management.commands.send_due_reminders._perth_now", return_value=self.fake_now):
            call_command("send_due_reminders", stdout=StringIO(), stderr=StringIO())

    def _logs(self, notification_type):
        return NotificationLog.objects.filter(user=self.user, type=notification_type)

    def test_content_reminder_is_pushed_and_logged_once_per_day(self):
        self._run()
        self._run()
        logs = self._logs(NotificationLog.NotificationType.CONTENT_REMINDER)
        self.assertEqual(
            list(logs.values_list("status", "channel", "content_item_id")),
            [(NotificationLog.Status.SENT, NotificationLog.Channel.PUSH, self.item.pk)],
        )
        self.assertEqual(_pushed_titles(self.push), [("Time for your daily meditation", f"/modules/{self.module.pk}")])

    def test_reminder_without_a_device_is_skipped_and_retried(self):
        PushSubscription.objects.all().delete()
        self._run()
        self._run()
        logs = self._logs(NotificationLog.NotificationType.CONTENT_REMINDER)
        self.assertEqual(list(logs.values_list("status", flat=True)), [NotificationLog.Status.SKIPPED] * 2)
        self.push.assert_not_called()

    def test_completed_item_is_still_reminded_daily(self):
        # Meditation is a daily practice: ticking the audio off doesn't stop the reminders.
        ContentCompletion.objects.create(user=self.user, content_item=self.item)
        self._run()
        self.assertTrue(self._logs(NotificationLog.NotificationType.CONTENT_REMINDER).exists())

    def test_survey_reminder_for_unlocked_unanswered_survey(self):
        NotificationPreference.objects.create(
            user=self.user, daily_content_reminder=False, daily_survey_reminder=True
        )
        ContentCompletion.objects.create(user=self.user, content_item=self.item)
        self._run()
        self._run()
        logs = self._logs(NotificationLog.NotificationType.SURVEY_PROMPT)
        self.assertEqual(list(logs.values_list("status", "module_id")), [(NotificationLog.Status.SENT, self.module.pk)])
        self.assertEqual(_pushed_titles(self.push), [("Don't forget your survey", "/surveys")])

    def test_survey_reminder_skips_locked_and_answered_surveys(self):
        NotificationPreference.objects.create(
            user=self.user, daily_content_reminder=False, daily_survey_reminder=True
        )
        self._run()  # content not complete, so the survey is still locked
        ContentCompletion.objects.create(user=self.user, content_item=self.item)
        survey = Survey.objects.get(module=self.module, type=SurveyType.WEEKLY)
        SurveyResponse.objects.create(user=self.user, survey=survey, answers={})
        self._run()  # unlocked but already answered
        self.assertFalse(self._logs(NotificationLog.NotificationType.SURVEY_PROMPT).exists())

    def test_dead_push_endpoint_shared_by_two_reminders(self):
        """The meditation reminder prunes the endpoint; the survey reminder in the same run must skip it, not crash."""
        from pywebpush import WebPushException
        NotificationPreference.objects.create(user=self.user, daily_survey_reminder=True)
        ContentCompletion.objects.create(user=self.user, content_item=self.item)
        self.push.side_effect = WebPushException("gone", response=type("R", (), {"status_code": 410})())
        self._run()
        self.assertFalse(PushSubscription.objects.filter(user=self.user).exists())
        self.assertEqual(self.push.call_count, 1)
        self.assertEqual(
            sorted(NotificationLog.objects.filter(user=self.user).values_list("status", flat=True)),
            [NotificationLog.Status.FAILED] * 2,
        )

    def test_survey_unlocked_notice_when_last_item_completed(self):
        NotificationPreference.objects.create(user=self.user, survey_unlocked_reminder=True)
        self.client.force_login(self.user)
        resp = self.client.post("/api/progress/", {"content_item": self.item.pk})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        logs = self._logs(NotificationLog.NotificationType.SURVEY_PROMPT)
        self.assertEqual(list(logs.values_list("status", flat=True)), [NotificationLog.Status.SENT])
        self.assertEqual(_pushed_titles(self.push), [("Your survey is now available", "/surveys")])

    def test_no_survey_unlocked_notice_without_opt_in(self):
        self.client.force_login(self.user)
        self.client.post("/api/progress/", {"content_item": self.item.pk})
        self.assertFalse(self._logs(NotificationLog.NotificationType.SURVEY_PROMPT).exists())


@override_settings(VAPID_PRIVATE_KEY="test-key")
class ReminderRunCharacterisationTests(TestCase):
    """One full hourly run covering every skip rule; pins the exact counts the command reports."""

    def test_full_run_counts(self):
        from zoneinfo import ZoneInfo
        today = timezone.localdate()
        running = Cohort.objects.create(name="Now", year=today.year, start_date=today, end_date=today + timedelta(days=56))
        future = Cohort.objects.create(
            name="Later", year=today.year, start_date=today + timedelta(days=30), end_date=today + timedelta(days=86),
        )
        with patch("app.signals._fire_async"):
            module = _make_module(week=1)
            item_a = _make_audio_item(module, title="A", display_order=1)
            item_b = _make_audio_item(module, title="B", display_order=2)
        users = {name: _make_user(f"{name}@test.local") for name in
                 ("plain", "nine", "optout", "denied", "half", "logged", "surveyor", "later", "nodevice")}
        for name, user in users.items():
            Enrollment.objects.create(user=user, cohort=future if name == "later" else running)
            if name != "nodevice":
                PushSubscription.objects.create(user=user, endpoint=f"https://push.example/{name}", p256dh="k", auth="a")
        NotificationPreference.objects.create(user=users["nine"], reminder_time=datetime.time(9, 0))
        NotificationPreference.objects.create(user=users["optout"], daily_content_reminder=False)
        NotificationPreference.objects.create(user=users["denied"], push_denied=True)
        NotificationPreference.objects.create(user=users["surveyor"], daily_survey_reminder=True)
        ContentCompletion.objects.create(user=users["half"], content_item=item_a)
        for item in (item_a, item_b):
            ContentCompletion.objects.create(user=users["surveyor"], content_item=item)
        NotificationLog.objects.create(
            user=users["logged"], type=NotificationLog.NotificationType.CONTENT_REMINDER, content_item=item_a,
            module=module, channel=NotificationLog.Channel.PUSH, scheduled_for=_perth_midnight_utc(today),
            status=NotificationLog.Status.SENT,
        )
        fake_now = datetime.datetime.combine(today, datetime.time(17, 0), tzinfo=ZoneInfo("Australia/Perth"))

        def run(*args):
            out = StringIO()
            with patch("app.management.commands.send_due_reminders._perth_now", return_value=fake_now), \
                    patch("pywebpush.webpush") as push:
                call_command("send_due_reminders", *args, stdout=out, stderr=StringIO())
            pushes.extend(_pushed_titles(push))
            return out.getvalue()

        pushes = []

        midnight = _perth_midnight_utc(today).isoformat()
        self.assertEqual(run("--dry-run"), (
            f"[send_due_reminders] date={today} hour=17 (Australia/Perth) scheduled_for={midnight} dry_run=True\n"
            # One reminder a day, for the week's first audio item (A), even if already completed.
            f"  [dry-run] would send reminder for 'A': user=plain@test.local day={today}\n"
            f"  [dry-run] would send reminder for 'A': user=half@test.local day={today}\n"
            f"  [dry-run] would send reminder for 'A': user=surveyor@test.local day={today}\n"
            f"  [dry-run] would skip (no device) reminder for 'A': user=nodevice@test.local day={today}\n"
            f"  [dry-run] would send survey reminder for 'Week 1': user=surveyor@test.local day={today}\n"
            "[send_due_reminders] done: sent=4 skipped=5 errors=0\n"
        ))
        self.assertEqual(pushes, [])
        self.assertTrue(run().endswith("[send_due_reminders] done: sent=4 skipped=5 errors=0\n"))
        sent = NotificationLog.objects.filter(status=NotificationLog.Status.SENT)
        self.assertEqual(
            sorted((log.user.email.split("@")[0], log.type, getattr(log.content_item, "title", None)) for log in sent),
            [("half", "content_reminder", "A"), ("logged", "content_reminder", "A"), ("plain", "content_reminder", "A"),
             ("surveyor", "content_reminder", "A"), ("surveyor", "survey_prompt", None)],
        )
        self.assertEqual(sorted(title for title, _ in pushes), [
            "Don't forget your survey", "Time for your daily meditation", "Time for your daily meditation",
            "Time for your daily meditation",
        ])
        self.assertTrue(NotificationLog.objects.filter(user=users["nodevice"], status=NotificationLog.Status.SKIPPED).exists())


def _push_error(status_code):
    from pywebpush import WebPushException
    return WebPushException(f"HTTP {status_code}", response=type("R", (), {"status_code": status_code})())


@override_settings(VAPID_PRIVATE_KEY="test-key", VAPID_ADMIN_EMAIL="admin@test.local")
class SendPushTests(TestCase):
    """send_push/deliver: what happens to each device for each kind of push-service answer."""

    def setUp(self):
        self.user = _make_user("push@test.local")
        self.sub = PushSubscription.objects.create(
            user=self.user, endpoint="https://push.example/device", p256dh="pkey", auth="akey",
        )

    def _deliver(self, side_effect=None):
        from ..notifications import deliver
        with patch("pywebpush.webpush", side_effect=side_effect) as push:
            result = deliver(user=self.user, payload_dict={"title": "Hello", "url": "/modules"})
        return result, push

    def test_sends_the_payload_signed_with_the_vapid_key(self):
        result, push = self._deliver()

        self.assertEqual(result, NotificationLog.Status.SENT)
        kwargs = push.call_args.kwargs
        self.assertEqual(
            kwargs["subscription_info"],
            {"endpoint": "https://push.example/device", "keys": {"p256dh": "pkey", "auth": "akey"}},
        )
        self.assertEqual(json.loads(kwargs["data"]), {"title": "Hello", "url": "/modules"})
        self.assertEqual(kwargs["vapid_private_key"], "test-key")
        self.assertEqual(kwargs["vapid_claims"], {"sub": "mailto:admin@test.local"})

    def test_a_device_the_push_service_no_longer_knows_is_removed(self):
        for status_code in (404, 410):
            with self.subTest(status=status_code):
                sub = PushSubscription.objects.create(
                    user=self.user, endpoint=f"https://push.example/{status_code}", p256dh="k", auth="a",
                )
                self.sub.delete()
                with self.assertLogs("app.notifications", "INFO") as logs:
                    result, _ = self._deliver(_push_error(status_code))
                self.assertEqual(result, NotificationLog.Status.FAILED)
                self.assertFalse(PushSubscription.objects.filter(pk=sub.pk).exists())
                self.assertIn("Pruned dead push endpoint", logs.output[0])
                self.sub = PushSubscription.objects.create(
                    user=self.user, endpoint="https://push.example/device", p256dh="k", auth="a",
                )

    def test_other_push_service_errors_keep_the_device_for_next_time(self):
        for status_code in (400, 413, 429, 500, 503):
            with self.subTest(status=status_code):
                with self.assertLogs("app.notifications", "WARNING") as logs:
                    result, _ = self._deliver(_push_error(status_code))
                self.assertEqual(result, NotificationLog.Status.FAILED)
                self.assertTrue(PushSubscription.objects.filter(pk=self.sub.pk).exists())
                self.assertIn("Push failed", logs.output[0])

    def test_an_error_with_no_response_keeps_the_device(self):
        from pywebpush import WebPushException
        with self.assertLogs("app.notifications", "WARNING"):
            result, _ = self._deliver(WebPushException("connection reset"))
        self.assertEqual(result, NotificationLog.Status.FAILED)
        self.assertTrue(PushSubscription.objects.filter(pk=self.sub.pk).exists())

    def test_an_unexpected_error_is_logged_not_raised(self):
        with self.assertLogs("app.notifications", "WARNING") as logs:
            result, _ = self._deliver(ConnectionError("network down"))
        self.assertEqual(result, NotificationLog.Status.FAILED)
        self.assertTrue(PushSubscription.objects.filter(pk=self.sub.pk).exists())
        self.assertIn("Push error", logs.output[0])

    @override_settings(VAPID_PRIVATE_KEY="")
    def test_nothing_is_sent_without_a_vapid_key(self):
        with self.assertLogs("app.notifications", "WARNING") as logs:
            result, push = self._deliver()
        self.assertEqual(result, NotificationLog.Status.FAILED)
        push.assert_not_called()
        self.assertIn("VAPID_PRIVATE_KEY not configured", logs.output[0])

    def test_nothing_is_sent_without_pywebpush_installed(self):
        from ..notifications import send_push
        with patch.dict("sys.modules", {"pywebpush": None}), self.assertLogs("app.notifications", "WARNING") as logs:
            self.assertFalse(send_push(self.user, {"title": "t"}, [self.sub]))
        self.assertIn("pywebpush not installed", logs.output[0])

    def test_a_device_pruned_earlier_in_the_run_is_skipped(self):
        from ..notifications import send_push
        subs = [self.sub]
        with patch("pywebpush.webpush", side_effect=_push_error(410)):
            send_push(self.user, {"title": "first"}, subs)
        # The caller reuses the same list for the next notification in this run.
        with patch("pywebpush.webpush") as push:
            self.assertFalse(send_push(self.user, {"title": "second"}, subs))
        push.assert_not_called()

    def test_skipped_when_the_user_refused_notifications(self):
        NotificationPreference.objects.create(user=self.user, push_denied=True)
        result, push = self._deliver()
        self.assertEqual(result, NotificationLog.Status.SKIPPED)
        push.assert_not_called()

    def test_skipped_when_the_user_has_no_device(self):
        self.sub.delete()
        result, push = self._deliver()
        self.assertEqual(result, NotificationLog.Status.SKIPPED)
        push.assert_not_called()


class NotificationHistoryTests(APITestCase):
    """GET /api/notifications/history/ lists the user's own delivered notifications."""

    URL = "/api/notifications/history/"

    def setUp(self):
        self.user = _make_user("inbox@test.local")
        self.other = _make_user("other@test.local")
        _enroll(self.user, self.other)
        self.module = _make_module(week=3)
        self.item = _make_audio_item(self.module, title="Body scan")
        # Module creation can fire S21 notifications; start from an empty log.
        NotificationLog.objects.all().delete()

    def _log(self, user=None, type=NotificationLog.NotificationType.MODULE_ADDED,
             status_=NotificationLog.Status.SENT, minutes_ago=0, **kwargs):
        when = timezone.now() - timedelta(minutes=minutes_ago)
        return NotificationLog.objects.create(
            user=user or self.user, type=type, module=kwargs.pop("module", self.module),
            channel=NotificationLog.Channel.PUSH, scheduled_for=when,
            sent_at=when if status_ == NotificationLog.Status.SENT else None,
            status=status_, **kwargs,
        )

    def test_lists_only_own_sent_notifications_newest_first(self):
        older = self._log(minutes_ago=60)
        newer = self._log(type=NotificationLog.NotificationType.SURVEY_PROMPT, minutes_ago=5)
        self._log(status_=NotificationLog.Status.FAILED)
        self._log(user=self.other)

        self.client.force_authenticate(user=self.user)
        resp = self.client.get(self.URL)

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([n["id"] for n in resp.data], [newer.id, older.id])

    def test_builds_display_text_from_type_and_module(self):
        self._log(minutes_ago=3)
        self._log(type=NotificationLog.NotificationType.CONTENT_REMINDER,
                  content_item=self.item, minutes_ago=2)
        self._log(type=NotificationLog.NotificationType.SURVEY_PROMPT, minutes_ago=1)

        self.client.force_authenticate(user=self.user)
        survey, reminder, added = self.client.get(self.URL).data

        self.assertEqual(added["title"], "Week 3 is now available")
        self.assertEqual(added["body"], "Week 3")
        self.assertEqual(added["url"], f"/modules/{self.module.id}/")
        self.assertEqual(reminder["title"], "Time for your daily meditation")
        self.assertEqual(reminder["body"], "Body scan")
        self.assertEqual(survey["url"], "/surveys")

    def test_survives_deleted_module(self):
        self._log()
        self.module.delete()

        self.client.force_authenticate(user=self.user)
        (entry,) = self.client.get(self.URL).data

        self.assertEqual(entry["title"], "A new week is now available")
        self.assertIsNone(entry["url"])

    def test_requires_authentication(self):
        resp = self.client.get(self.URL)
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_is_read_only(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(self.URL, {})
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_new_notifications_are_unread(self):
        self._log()
        self.client.force_authenticate(user=self.user)
        (entry,) = self.client.get(self.URL).data
        self.assertIsNone(entry["read_at"])

    def test_mark_one_as_read(self):
        target = self._log(minutes_ago=1)
        other = self._log()

        self.client.force_authenticate(user=self.user)
        resp = self.client.post(f"{self.URL}{target.id}/read/")

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(resp.data["read_at"])
        target.refresh_from_db()
        other.refresh_from_db()
        self.assertIsNotNone(target.read_at)
        self.assertIsNone(other.read_at)

    def test_marking_read_again_keeps_first_timestamp(self):
        target = self._log()
        self.client.force_authenticate(user=self.user)
        first = self.client.post(f"{self.URL}{target.id}/read/").data["read_at"]
        second = self.client.post(f"{self.URL}{target.id}/read/").data["read_at"]
        self.assertEqual(first, second)

    def test_cannot_mark_another_users_notification(self):
        theirs = self._log(user=self.other)
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(f"{self.URL}{theirs.id}/read/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        theirs.refresh_from_db()
        self.assertIsNone(theirs.read_at)

    def test_cannot_mark_failed_notification(self):
        failed = self._log(status_=NotificationLog.Status.FAILED)
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(f"{self.URL}{failed.id}/read/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_mark_all_as_read_only_touches_own(self):
        mine = [self._log(minutes_ago=i) for i in range(3)]
        theirs = self._log(user=self.other)

        self.client.force_authenticate(user=self.user)
        resp = self.client.post(f"{self.URL}read-all/")

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["marked"], 3)
        for n in mine:
            n.refresh_from_db()
            self.assertIsNotNone(n.read_at)
        theirs.refresh_from_db()
        self.assertIsNone(theirs.read_at)
