"""The Django admin site (/django-admin/): every page loads, and its custom warnings and validation work."""

import json
from unittest.mock import Mock, patch

from django.contrib import admin
from django.urls import reverse

from ..admin import ContentItemAdmin, ModuleAdmin, PushSubscriptionAdmin, SurveyAdmin, SurveyAdminForm
from ..models import (
    Cohort,
    ContentItem,
    Enrollment,
    ForumPost,
    ForumThread,
    Module,
    PushSubscription,
    Survey,
    SurveyType,
)
from .base import TestCase, User


@patch("app.signals._fire_async")
class AdminPagesLoadTests(TestCase):
    """Catches a bad list_display, search field or form field before an admin finds it."""

    def setUp(self):
        self.superuser = User.objects.create_superuser(email="root@test.local", password="testpass")
        self.client.force_login(self.superuser)
        student = User.objects.create_user(email="s@test.local", password="testpass")
        cohort = Cohort.objects.create(name="C", year=2026, start_date="2026-01-01", end_date="2026-03-01")
        Enrollment.objects.create(user=student, cohort=cohort)
        module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        ContentItem.objects.create(module=module, title="Body scan", type="audio", provider="soundcloud", day_offset=1)
        thread = ForumThread.objects.create(created_by=student, title="Hello")
        ForumPost.objects.create(thread=thread, author=student, body="Hi", is_head_post=True)
        PushSubscription.objects.create(user=student, endpoint="https://push.example/" + "x" * 100, p256dh="k", auth="a")

    def _models(self):
        return [model for model in admin.site._registry if model._meta.app_label == "app"]

    def test_every_list_page_loads_and_can_be_searched(self, _fire):
        for model in self._models():
            url = reverse(f"admin:app_{model._meta.model_name}_changelist")
            with self.subTest(model=model.__name__):
                self.assertEqual(self.client.get(url).status_code, 200)
                self.assertEqual(self.client.get(url, {"q": "a"}).status_code, 200)

    def test_every_add_page_loads(self, _fire):
        for model in self._models():
            with self.subTest(model=model.__name__):
                self.assertEqual(self.client.get(reverse(f"admin:app_{model._meta.model_name}_add")).status_code, 200)

    def test_every_edit_page_loads(self, _fire):
        for model in self._models():
            obj = model.objects.first()
            if obj is None:
                continue
            with self.subTest(model=model.__name__):
                url = reverse(f"admin:app_{model._meta.model_name}_change", args=[obj.pk])
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_students_cannot_open_the_admin_site(self, _fire):
        self.client.force_login(User.objects.get(email="s@test.local"))
        response = self.client.get(reverse("admin:index"))
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse("admin:login"), response["Location"])


@patch("app.signals._fire_async")
class DuplicateDayOffsetWarningTests(TestCase):
    """Two audio items on the same day_offset would only send one reminder, so the admin is warned."""

    def setUp(self):
        self.module = Module.objects.create(week_number=1, title="Week 1")
        ContentItem.objects.create(module=self.module, title="First", type="audio", provider="soundcloud", day_offset=2)
        self.request = Mock()

    def _save_item(self, **fields):
        item = ContentItem(module=self.module, title="Second", provider="soundcloud", **fields)
        model_admin = ContentItemAdmin(ContentItem, admin.site)
        with patch.object(ContentItemAdmin, "message_user") as message:
            model_admin.save_model(self.request, item, form=None, change=False)
        return message

    def test_saving_an_audio_item_on_a_taken_day_warns(self, _fire):
        message = self._save_item(type="audio", day_offset=2)
        message.assert_called_once()
        self.assertIn("already uses day_offset=2", message.call_args.args[1])

    def test_a_free_day_or_a_video_does_not_warn(self, _fire):
        for fields in ({"type": "audio", "day_offset": 3}, {"type": "audio", "day_offset": None}, {"type": "video", "day_offset": 2}):
            with self.subTest(**fields):
                self._save_item(**fields).assert_not_called()

    def test_saving_a_module_with_clashing_audio_warns(self, _fire):
        ContentItem.objects.create(module=self.module, title="Second", type="audio", provider="soundcloud", day_offset=2)
        model_admin = ModuleAdmin(Module, admin.site)
        with patch.object(ModuleAdmin, "message_user") as message:
            model_admin.save_related(self.request, Mock(instance=self.module), formsets=[], change=True)
        message.assert_called_once()
        self.assertIn("share day_offset value(s) [2]", message.call_args.args[1])

    def test_saving_a_module_without_clashes_does_not_warn(self, _fire):
        model_admin = ModuleAdmin(Module, admin.site)
        with patch.object(ModuleAdmin, "message_user") as message:
            model_admin.save_related(self.request, Mock(instance=self.module), formsets=[], change=True)
        message.assert_not_called()


class SurveyAdminFormTests(TestCase):
    """The admin form applies the same question rules as the admin API."""

    def _form(self, questions):
        return SurveyAdminForm(data={
            "code": "end-test", "title": "End", "type": SurveyType.END, "questions": json.dumps(questions),
        })

    def test_valid_questions_are_accepted(self):
        form = self._form([{"id": "q1", "type": "integer", "text": "How many minutes?"}])
        self.assertTrue(form.is_valid(), form.errors)

    def test_invalid_questions_are_rejected_on_the_questions_field(self):
        for questions in ([{"id": "q1", "type": "not-a-type", "text": "?"}], [{"type": "integer", "text": "no id"}], "not a list"):
            with self.subTest(questions=questions):
                form = self._form(questions)
                self.assertFalse(form.is_valid())
                self.assertIn("questions", form.errors)


class AdminDisplayColumnTests(TestCase):
    def test_question_count(self):
        survey_admin = SurveyAdmin(Survey, admin.site)
        self.assertEqual(survey_admin.question_count(Survey(questions=[{"id": "a"}, {"id": "b"}])), 2)
        self.assertEqual(survey_admin.question_count(Survey(questions=[])), 0)

    def test_long_push_endpoints_are_shortened(self):
        sub_admin = PushSubscriptionAdmin(PushSubscription, admin.site)
        self.assertEqual(sub_admin.endpoint_truncated(PushSubscription(endpoint="https://short")), "https://short")
        long = "https://push.example/" + "x" * 100
        self.assertEqual(sub_admin.endpoint_truncated(PushSubscription(endpoint=long)), long[:80] + "…")
