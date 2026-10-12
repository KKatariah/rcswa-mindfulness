"""Management commands not covered elsewhere: push_adoption, import_rcswa_modules, seed_site and seed_moderation."""

import json
import os
from datetime import date, timedelta
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.core.management import CommandError, call_command

from ..models import Cohort, ContentCompletion, ContentItem, Enrollment, Module, PushSubscription, Survey, User
from .base import TestCase, _make_user

RCSWA_CONTENT = Path(__file__).resolve().parents[1] / "content" / "rcswa_modules.json"


def _run(*args, **kwargs):
    out = StringIO()
    call_command(*args, stdout=out, stderr=StringIO(), **kwargs)
    return out.getvalue()


class PushAdoptionCommandTests(TestCase):
    def setUp(self):
        today = date.today()
        self.cohort = Cohort.objects.create(
            name="Term 4", year=today.year, start_date=today - timedelta(days=7), end_date=today + timedelta(days=50),
        )

    def _student(self, email, devices=0, cohort=None, status=Enrollment.Status.ACTIVE):
        user = _make_user(email)
        Enrollment.objects.create(user=user, cohort=cohort or self.cohort, status=status)
        for n in range(devices):
            PushSubscription.objects.create(
                user=user, endpoint=f"https://push.example/{email}/{n}", p256dh="k", auth="a")
        return user

    def test_says_so_when_no_cohort_is_running(self):
        self.assertEqual(_run("push_adoption").strip(), "No active cohorts.")

    def test_reports_each_active_cohort(self):
        self._student("a@test.local", devices=1)
        self._student("b@test.local", devices=2)  # two devices still count as one student
        self._student("c@test.local")

        out = _run("push_adoption")

        row = next(line for line in out.splitlines() if line.startswith("Term 4"))
        self.assertEqual(row.split()[-3:], ["3", "2", "66.7%"])

    def test_csv_output(self):
        self._student("a@test.local", devices=1)
        self._student("b@test.local")

        rows = _run("push_adoption", "--csv").splitlines()

        self.assertEqual(rows[0].strip(), "cohort,active_enrollments,users_with_push,adoption_pct")
        self.assertEqual(rows[1].strip(), f"Term 4 ({self.cohort.year}),2,1,50.0")

    def test_counts_only_active_students_in_running_cohorts(self):
        today = date.today()
        finished = Cohort.objects.create(
            name="Last term", year=today.year, start_date=today - timedelta(days=100), end_date=today - timedelta(days=1),
        )
        self._student("old@test.local", devices=1, cohort=finished)
        self._student("pending@test.local", devices=1, status=Enrollment.Status.PENDING)
        self._student("active@test.local")

        out = _run("push_adoption")

        self.assertNotIn("Last term", out)
        row = next(line for line in out.splitlines() if line.startswith("Term 4"))
        self.assertEqual(row.split()[-3:], ["1", "0", "0.0%"])


@patch("app.signals._fire_async")
class ImportRcswaModulesCommandTests(TestCase):
    """The importer must be safe to run repeatedly against a live database."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.data = json.loads(RCSWA_CONTENT.read_text(encoding="utf-8"))
        cls.media_count = sum(len(m["content_items"]) for m in cls.data["modules"])

    def test_imports_the_introduction_and_eight_weeks(self, _fire):
        out = _run("import_rcswa_modules")

        self.assertEqual(list(Module.objects.order_by("week_number").values_list(
            "week_number", flat=True)), list(range(9)))
        self.assertEqual(ContentItem.objects.count(), self.media_count)
        self.assertFalse(Module.objects.filter(is_published=True).exists())
        self.assertIn(f"Imported 9 modules and {self.media_count} media items.", out)
        week1 = Module.objects.get(week_number=1)
        self.assertEqual(week1.title, self.data["modules"][1]["title"])
        self.assertEqual(
            list(week1.content_items.order_by("display_order").values_list("embed_url", flat=True)),
            [m["embed_url"] for m in self.data["modules"][1]["content_items"]],
        )

    def test_running_it_again_creates_no_duplicates(self, _fire):
        _run("import_rcswa_modules")
        ids = set(ContentItem.objects.values_list("pk", flat=True))

        _run("import_rcswa_modules")

        self.assertEqual(Module.objects.count(), 9)
        self.assertEqual(set(ContentItem.objects.values_list("pk", flat=True)), ids)

    def test_dry_run_saves_nothing(self, _fire):
        out = _run("import_rcswa_modules", "--dry-run")

        self.assertIn("Dry run: no changes saved.", out)
        self.assertFalse(Module.objects.exists())
        self.assertFalse(ContentItem.objects.exists())

    def test_publish_flag_publishes(self, _fire):
        _run("import_rcswa_modules", "--publish")
        self.assertEqual(Module.objects.filter(is_published=True).count(), 9)

    def test_keeps_an_existing_module_published_and_its_learner_records(self, _fire):
        module = Module.objects.create(week_number=2, title="Old title", is_published=True)
        item = ContentItem.objects.create(
            module=module, title="Old", type="video", provider="youtube",
            embed_url=self.data["modules"][2]["content_items"][0]["embed_url"],
        )
        ContentCompletion.objects.create(user=_make_user("s@test.local"), content_item=item)

        _run("import_rcswa_modules")

        module.refresh_from_db()
        self.assertTrue(module.is_published)
        self.assertEqual(module.title, self.data["modules"][2]["title"])
        self.assertTrue(ContentCompletion.objects.filter(content_item_id=item.pk).exists())
        self.assertEqual(module.content_items.count(), len(self.data["modules"][2]["content_items"]))

    def test_replaces_a_development_placeholder_in_place(self, _fire):
        module = Module.objects.create(week_number=1, title="Week 1")
        placeholder = ContentItem.objects.create(
            module=module, title="Placeholder", type="video", provider="youtube",
            embed_url="https://www.youtube.com/embed/ZToicYcHIOU",
        )

        _run("import_rcswa_modules")

        placeholder.refresh_from_db()
        self.assertEqual(placeholder.embed_url, self.data["modules"][1]["content_items"][0]["embed_url"])
        self.assertEqual(module.content_items.count(), len(self.data["modules"][1]["content_items"]))

    def test_refuses_to_overwrite_a_placeholder_with_learner_history(self, _fire):
        module = Module.objects.create(week_number=1, title="Week 1")
        placeholder = ContentItem.objects.create(
            module=module, title="Placeholder", type="video", provider="youtube",
            embed_url="https://www.youtube.com/embed/ZToicYcHIOU",
        )
        ContentCompletion.objects.create(user=_make_user("s@test.local"), content_item=placeholder)

        with self.assertRaisesMessage(CommandError, f"Placeholder item {placeholder.pk} has learner history"):
            _run("import_rcswa_modules")

        # Nothing from the run was kept.
        self.assertEqual(Module.objects.count(), 1)
        placeholder.refresh_from_db()
        self.assertEqual(placeholder.title, "Placeholder")

    def test_refuses_when_a_week_has_several_placeholders(self, _fire):
        module = Module.objects.create(week_number=1, title="Week 1")
        for video_id in ("ZToicYcHIOU", "QS2yDmWk0vs"):
            ContentItem.objects.create(
                module=module, title=video_id, type="video", provider="youtube",
                embed_url=f"https://www.youtube.com/embed/{video_id}",
            )

        with self.assertRaisesMessage(CommandError, "Multiple placeholder items in week 1"):
            _run("import_rcswa_modules")

    def test_rejects_content_that_isnt_weeks_0_to_8(self, _fire):
        bad = {"modules": self.data["modules"][:3]}
        with patch("pathlib.Path.read_text", return_value=json.dumps(bad)):
            with self.assertRaisesMessage(CommandError, "Expected exactly weeks 0–8."):
                _run("import_rcswa_modules")
        self.assertFalse(Module.objects.exists())


class SeedModerationCommandTests(TestCase):
    def setUp(self):
        self.admin = _make_user("admin@test.local")
        self.admin.role = "admin"
        self.admin.save()

    def _as_admin(self):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(self.admin)
        return client

    def test_fills_every_moderation_tab(self):
        _run("seed_moderation")
        client = self._as_admin()
        self.assertEqual(client.get("/api/forum/posts/reported/").data["count"], 5)
        self.assertEqual(client.get("/api/forum/posts/removed/").data["count"], 4)
        self.assertEqual(client.get("/api/users/?forum_banned=true").data["count"], 2)
        from ..models import ForumThread
        self.assertFalse(ForumThread.objects.filter(cohort__isnull=True).exists())

    def test_rerunning_resets_and_clear_removes_it(self):
        _run("seed_moderation")
        _run("seed_moderation")
        client = self._as_admin()
        self.assertEqual(client.get("/api/forum/posts/reported/").data["count"], 5)
        _run("seed_moderation", "--clear")
        from ..models import ForumFlag, ForumThread, User
        self.assertFalse(User.objects.filter(email__endswith="@moderation-demo.test").exists())
        self.assertFalse(ForumThread.objects.exists())
        self.assertFalse(ForumFlag.objects.exists())
        self.assertFalse(Cohort.objects.filter(name="Moderation demo").exists())
        self.assertTrue(User.objects.filter(pk=self.admin.pk).exists())


ADMIN_ENV = {
    "DJANGO_SUPERUSER_EMAIL": "admin@example.org",
    "DJANGO_SUPERUSER_FULL_NAME": "Site Admin",
    "DJANGO_SUPERUSER_PASSWORD": "a-long-test-password",
}


@patch("app.signals._fire_async")
@patch("sys.stdin.isatty", return_value=False)
@patch.dict(os.environ, ADMIN_ENV)
class SeedSiteCommandTests(TestCase):
    """First-time server setup: modules, one weekly survey per week 1-8, one admin."""

    def test_seeds_modules_surveys_and_an_admin(self, _tty, _fire):
        out = _run("seed_site")

        self.assertEqual(Module.objects.count(), 9)
        self.assertEqual(
            list(Survey.objects.filter(type="weekly").values_list("module__week_number", flat=True)),
            list(range(1, 9)),
        )
        admin = User.objects.get(email="admin@example.org")
        self.assertTrue(admin.is_superuser)
        self.assertEqual(admin.role, User.Role.ADMIN)
        self.assertTrue(admin.check_password("a-long-test-password"))
        self.assertIn("Some modules are unpublished", out)

    def test_running_it_again_changes_nothing(self, _tty, _fire):
        _run("seed_site")
        out = _run("seed_site")

        self.assertEqual(Module.objects.count(), 9)
        self.assertEqual(Survey.objects.count(), 8)
        self.assertEqual(User.objects.count(), 1)
        self.assertIn("An admin already exists (admin@example.org)", out)

    def test_leaves_existing_modules_alone(self, _tty, _fire):
        _run("seed_site")
        Module.objects.filter(week_number=1).update(title="Edited by an admin")

        out = _run("seed_site")

        self.assertEqual(Module.objects.get(week_number=1).title, "Edited by an admin")
        self.assertIn("Modules already exist; not re-imported.", out)

    def test_keeps_an_existing_admin(self, _tty, _fire):
        User.objects.create_superuser(email="first@example.org", password="pw", full_name="First")

        _run("seed_site")

        self.assertEqual(list(User.objects.values_list("email", flat=True)), ["first@example.org"])

    def test_publish_flag_publishes_the_modules(self, _tty, _fire):
        out = _run("seed_site", "--publish")

        self.assertFalse(Module.objects.filter(is_published=False).exists())
        self.assertNotIn("unpublished", out)
