"""Surveys: answering, unlocking, per-module creation, admin management and export."""

from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from ..models import (
    ContentCompletion,
    ContentItem,
    Enrollment,
    Module,
    Survey,
    SurveyResponse,
    SurveyType,
)
from .base import User, TestCase, APITestCase, _enroll, _drop_auto_surveys, _cohort


class SurveyTests(APITestCase):
    # Minimal question set covering all types and the skip_if mechanic.
    QUESTIONS = [
        {"id": "q1", "type": "integer", "text": "Session count"},
        {"id": "q2", "type": "likert", "text": "Rate it", "min": 0, "max": 6,
         "skip_if": {"question_id": "q1", "value": 0}},
        {"id": "q3", "type": "longtext", "text": "Describe your week"},
    ]
    VALID_ANSWERS = {"q1": 3, "q2": 5, "q3": "Feeling good"}

    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass", full_name="Student One"
        )
        self.other = User.objects.create_user(
            email="other@test.local", password="testpass", full_name="Other User"
        )
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass",
            full_name="Admin User", role=User.Role.ADMIN,
        )
        _enroll(self.student, self.other)
        self.module = Module.objects.create(
            week_number=1, title="Week 1", is_published=True
        )
        self.item = ContentItem.objects.create(
            module=self.module, title="Intro video", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/x",
        )
        # The post_save signal auto-creates a weekly survey; update it to match
        # the test's expected code/title/questions rather than creating a duplicate.
        self.survey, _ = Survey.objects.update_or_create(
            module=self.module,
            type="weekly",
            defaults={
                "code": "test-weekly",
                "title": "Test Weekly Survey",
                "questions": self.QUESTIONS,
            },
        )

    def _complete_all(self, user):
        ContentCompletion.objects.get_or_create(user=user, content_item=self.item)

    # ── Unlock rule ────────────────────────────────────────────────────────────

    def test_locked_survey_returns_403_on_submit(self):
        """No completions → POST → 403."""
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": self.VALID_ANSWERS},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("locked", resp.data["detail"].lower())

    def test_survey_unlocked_when_all_content_complete(self):
        """Completing all content items makes is_unlocked True in the list."""
        self._complete_all(self.student)
        self.client.force_login(self.student)
        resp = self.client.get("/api/surveys/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        survey_data = next(s for s in resp.data if s["id"] == self.survey.pk)
        self.assertTrue(survey_data["is_unlocked"])

    def test_survey_locked_when_content_incomplete(self):
        """No completions → is_unlocked False."""
        self.client.force_login(self.student)
        resp = self.client.get("/api/surveys/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        survey_data = next(s for s in resp.data if s["id"] == self.survey.pk)
        self.assertFalse(survey_data["is_unlocked"])

    def test_list_query_count_does_not_grow_with_surveys(self):
        """has_responded and is_unlocked come from per-request sets, not a query per survey."""
        self._complete_all(self.student)
        SurveyResponse.objects.create(user=self.student, survey=self.survey, answers=self.VALID_ANSWERS)
        self.client.force_login(self.student)

        def add_modules(weeks):
            for week in weeks:
                with patch("app.signals._fire_async"):
                    Module.objects.create(week_number=week, title=f"Week {week}", is_published=True)

        def list_queries():
            with CaptureQueriesContext(connection) as ctx:
                self.assertEqual(self.client.get("/api/surveys/").status_code, status.HTTP_200_OK)
            return len(ctx)

        # Start with one unanswered survey too, so the one-off cohort lookup is in the baseline.
        add_modules([2])
        before = list_queries()
        add_modules(range(3, 8))
        self.assertEqual(list_queries(), before)

    def test_non_weekly_survey_without_module_always_unlocked(self):
        """Intake/end/followup surveys with no module are always unlocked."""
        global_survey = Survey.objects.create(
            code="global-intake", title="Intake", type="intake", questions=[]
        )
        self.client.force_login(self.student)
        resp = self.client.get("/api/surveys/")
        survey_data = next(s for s in resp.data if s["id"] == global_survey.pk)
        self.assertTrue(survey_data["is_unlocked"])

    def test_weekly_survey_without_module_is_locked(self):
        """An orphaned weekly survey (module=null) is never unlocked.

        Orphaned surveys are hidden from students (tested separately in
        OrphanedSurveyTests), so verify via the admin view which still returns them.
        """
        orphan = Survey(code="orphan-weekly", title="Orphan", type="weekly", questions=[])
        orphan.save()
        self.client.force_login(self.admin)
        resp = self.client.get("/api/surveys/")
        survey_data = next(s for s in resp.data if s["id"] == orphan.pk)
        self.assertFalse(survey_data["is_unlocked"])

    def test_weekly_survey_without_module_rejected_by_full_clean(self):
        """Model.clean() must reject a weekly survey with no module."""
        from django.core.exceptions import ValidationError as DjangoValidationError
        survey = Survey(code="orphan2", title="Orphan", type="weekly", module=None, questions=[])
        with self.assertRaises(DjangoValidationError) as ctx:
            survey.full_clean()
        self.assertIn("module", ctx.exception.message_dict)

    # ── Submit & duplicate ─────────────────────────────────────────────────────

    def test_unlocked_survey_submit_succeeds(self):
        self._complete_all(self.student)
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": self.VALID_ANSWERS},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(SurveyResponse.objects.filter(user=self.student, survey=self.survey).exists())

    def test_second_submit_returns_400(self):
        """A second POST for the same (user, survey) pair returns 400."""
        self._complete_all(self.student)
        self.client.force_login(self.student)
        payload = {"survey": self.survey.pk, "answers": self.VALID_ANSWERS}
        self.client.post("/api/survey-responses/", payload, content_type="application/json")
        resp = self.client.post("/api/survey-responses/", payload, content_type="application/json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("PATCH", resp.data["detail"])

    def test_has_responded_reflects_submission(self):
        self.client.force_login(self.student)
        resp_before = self.client.get("/api/surveys/")
        survey_before = next(s for s in resp_before.data if s["id"] == self.survey.pk)
        self.assertFalse(survey_before["has_responded"])

        self._complete_all(self.student)
        self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": self.VALID_ANSWERS},
            content_type="application/json",
        )
        resp_after = self.client.get("/api/surveys/")
        survey_after = next(s for s in resp_after.data if s["id"] == self.survey.pk)
        self.assertTrue(survey_after["has_responded"])

    # ── PATCH own response ─────────────────────────────────────────────────────

    def test_student_can_patch_own_response(self):
        self._complete_all(self.student)
        self.client.force_login(self.student)
        self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": self.VALID_ANSWERS},
            content_type="application/json",
        )
        response_obj = SurveyResponse.objects.get(user=self.student, survey=self.survey)
        new_answers = {"q1": 5, "q2": 4, "q3": "Updated description"}
        resp = self.client.patch(
            f"/api/survey-responses/{response_obj.pk}/",
            {"answers": new_answers},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        response_obj.refresh_from_db()
        self.assertEqual(response_obj.answers["q1"], 5)

    def test_student_cannot_patch_another_students_response(self):
        self._complete_all(self.other)
        self.client.force_login(self.other)
        self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": self.VALID_ANSWERS},
            content_type="application/json",
        )
        response_obj = SurveyResponse.objects.get(user=self.other, survey=self.survey)

        self.client.force_login(self.student)
        resp = self.client.patch(
            f"/api/survey-responses/{response_obj.pk}/",
            {"answers": {"q1": 0, "q3": "Hacked"}},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    # ── Isolation ──────────────────────────────────────────────────────────────

    def test_student_cannot_list_others_responses(self):
        """GET /api/survey-responses/ is not supported (no list action)."""
        self.client.force_login(self.student)
        resp = self.client.get("/api/survey-responses/")
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    # ── Answer validation ──────────────────────────────────────────────────────

    def test_likert_out_of_range_returns_400(self):
        self._complete_all(self.student)
        self.client.force_login(self.student)
        bad_answers = {"q1": 3, "q2": 7, "q3": "OK"}  # q2 max is 6
        resp = self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": bad_answers},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_negative_integer_returns_400(self):
        self._complete_all(self.student)
        self.client.force_login(self.student)
        bad_answers = {"q1": -1, "q2": 3, "q3": "OK"}
        resp = self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": bad_answers},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_required_question_returns_400(self):
        self._complete_all(self.student)
        self.client.force_login(self.student)
        bad_answers = {"q1": 3, "q2": 5}  # q3 (longtext) missing
        resp = self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": bad_answers},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_question_id_returns_400(self):
        self._complete_all(self.student)
        self.client.force_login(self.student)
        bad_answers = {**self.VALID_ANSWERS, "q99": "mystery"}
        resp = self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": bad_answers},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_skipped_questions_not_required_when_trigger_met(self):
        """When q1=0, q2 (skip_if q1==0) must be omitted without error."""
        self._complete_all(self.student)
        self.client.force_login(self.student)
        answers_no_q2 = {"q1": 0, "q3": "Rest week"}  # q2 skipped
        resp = self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": answers_no_q2},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_skipped_question_still_required_when_trigger_not_met(self):
        """When q1 > 0, q2 is NOT skipped and must be answered."""
        self._complete_all(self.student)
        self.client.force_login(self.student)
        answers_missing_q2 = {"q1": 2, "q3": "Did some practice"}
        resp = self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": answers_missing_q2},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # ── Retrieve includes questions ────────────────────────────────────────────

    def test_retrieve_includes_questions_field(self):
        self.client.force_login(self.student)
        resp = self.client.get(f"/api/surveys/{self.survey.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("questions", resp.data)
        self.assertEqual(len(resp.data["questions"]), len(self.QUESTIONS))

    def test_list_does_not_include_questions_field(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/surveys/")
        survey_data = next(s for s in resp.data if s["id"] == self.survey.pk)
        self.assertNotIn("questions", survey_data)

    # ── Admin: module responses ────────────────────────────────────────────────

    def test_admin_can_list_module_responses(self):
        self._complete_all(self.student)
        self.client.force_login(self.student)
        self.client.post(
            "/api/survey-responses/",
            {"survey": self.survey.pk, "answers": self.VALID_ANSWERS},
            content_type="application/json",
        )
        self.client.force_login(self.admin)
        resp = self.client.get(f"/api/surveys/module-responses/?module={self.module.pk}")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["student_name"], "Student One")
        self.assertIn("submitted_at", resp.data[0])

    def test_student_cannot_access_module_responses(self):
        self.client.force_login(self.student)
        resp = self.client.get(f"/api/surveys/module-responses/?module={self.module.pk}")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_module_responses_requires_module_param(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/api/surveys/module-responses/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_module_responses_scoped_to_module(self):
        """Responses for a different module are not included."""
        other_module = Module.objects.create(week_number=2, title="Week 2", is_published=True)
        other_item = ContentItem.objects.create(
            module=other_module, title="W2 video", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/y",
        )
        other_survey, _ = Survey.objects.update_or_create(
            module=other_module,
            type="weekly",
            defaults={"code": "w2-survey", "title": "Week 2 Survey", "questions": self.QUESTIONS},
        )
        ContentCompletion.objects.create(user=self.student, content_item=other_item)
        self.client.force_login(self.student)
        self.client.post(
            "/api/survey-responses/",
            {"survey": other_survey.pk, "answers": self.VALID_ANSWERS},
            content_type="application/json",
        )
        self.client.force_login(self.admin)
        resp = self.client.get(f"/api/surveys/module-responses/?module={self.module.pk}")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 0)


class SurveyFixtureFlowTests(APITestCase):
    """
    End-to-end test using the real fixtures.
    Load order: dev_seed (creates modules + content items) then weekly_survey
    (creates one Survey per module, both referencing dev_seed's module PKs).
    """
    fixtures = ["dev_seed", "weekly_survey"]

    # Full valid MAQ answers — q1 > 0 so q2-q6 are not skipped.
    VALID_MAQ_ANSWERS = {
        "q1": 3,
        "q2": 20,
        "q3": 5, "q4": 4, "q5": 5, "q6": 4,
        "q7": 5, "q8": 4, "q9": 3, "q10": 5, "q11": 4, "q12": 3,
        "q13": "Feeling more present and calm. Regular practice helped me stay focused.",
    }

    def setUp(self):
        self.student = User.objects.create_user(
            email="fixture_student@test.local",
            password="testpass",
            full_name="Fixture Student",
        )
        _enroll(self.student)

    def test_week1_survey_locked_unlocked_and_submittable(self):
        """
        Full lifecycle using fixture data:
        1. Week 1 survey is locked while content is incomplete.
        2. Completing all week-1 content items unlocks it.
        3. A valid submission is accepted with 201.
        """
        survey = Survey.objects.get(code="weekly-maq-w1")

        # ── Step 1: survey is locked ───────────────────────────────────────────
        self.client.force_login(self.student)

        list_resp = self.client.get("/api/surveys/")
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        survey_data = next(s for s in list_resp.data if s["id"] == survey.pk)
        self.assertFalse(survey_data["is_unlocked"])
        self.assertFalse(survey_data["has_responded"])

        submit_resp = self.client.post(
            "/api/survey-responses/",
            {"survey": survey.pk, "answers": self.VALID_MAQ_ANSWERS},
            content_type="application/json",
        )
        self.assertEqual(submit_resp.status_code, status.HTTP_403_FORBIDDEN)

        # ── Step 2: complete every ContentItem in week 1 ─────────────────────
        week1_items = list(ContentItem.objects.filter(module__week_number=1))
        self.assertTrue(week1_items, "dev_seed must contain content items for week 1")
        for item in week1_items:
            ContentCompletion.objects.create(user=self.student, content_item=item)

        list_resp2 = self.client.get("/api/surveys/")
        survey_data2 = next(s for s in list_resp2.data if s["id"] == survey.pk)
        self.assertTrue(survey_data2["is_unlocked"])

        # ── Step 3: submit succeeds ────────────────────────────────────────────
        submit_resp2 = self.client.post(
            "/api/survey-responses/",
            {"survey": survey.pk, "answers": self.VALID_MAQ_ANSWERS},
            content_type="application/json",
        )
        self.assertEqual(submit_resp2.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            SurveyResponse.objects.filter(user=self.student, survey=survey).exists()
        )

        list_resp3 = self.client.get("/api/surveys/")
        survey_data3 = next(s for s in list_resp3.data if s["id"] == survey.pk)
        self.assertTrue(survey_data3["has_responded"])


class SurveyResponseProtectionTests(TestCase):
    def test_survey_with_responses_cannot_be_deleted(self):
        from django.db.models import ProtectedError
        user = User.objects.create_user(email="s@test.local", password="testpass")
        survey = Survey.objects.create(code="intake", title="Intake", type=Survey.SurveyType.INTAKE)
        SurveyResponse.objects.create(user=user, survey=survey, answers={"q1": 1})
        with self.assertRaises(ProtectedError):
            survey.delete()
        self.assertEqual(SurveyResponse.objects.count(), 1)


class SurveyEdgeCaseTests(APITestCase):
    QUESTIONS = [
        {"id": "q1", "type": "integer"},
        {"id": "q2", "type": "integer", "skip_if": {"question_id": "q1", "value": 0}},
        {"id": "q13", "type": "longtext"},
    ]

    def setUp(self):
        self.user = User.objects.create_user(email="s@test.local", password="testpass")
        _enroll(self.user)
        with patch("app.signals._fire_async"):
            self.module = Module.objects.create(week_number=1, title="W1", is_published=True)
            self.item = ContentItem.objects.create(
                module=self.module, title="V", type=ContentItem.ContentType.VIDEO,
                provider="youtube", embed_url="https://www.youtube.com/embed/ZToicYcHIOU",
            )
        ContentCompletion.objects.create(user=self.user, content_item=self.item)
        _drop_auto_surveys(self.module)
        self.survey = Survey.objects.create(
            module=self.module, code="w1", title="W1", type=Survey.SurveyType.WEEKLY, questions=self.QUESTIONS,
        )
        self.client.force_login(self.user)

    def _submit(self, answers):
        return self.client.post(
            "/api/survey-responses/", {"survey": self.survey.pk, "answers": answers}, format="json",
        )

    def test_zero_meditation_skips_follow_up_questions(self):
        self.assertEqual(self._submit({"q1": 0, "q13": "Busy week."}).status_code, status.HTTP_201_CREATED)

    def test_journal_over_limit_rejected(self):
        resp = self._submit({"q1": 1, "q2": 10, "q13": "x" * 5001})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_submitted_survey_stays_unlocked_after_new_content(self):
        self.assertEqual(self._submit({"q1": 0, "q13": "Done."}).status_code, status.HTTP_201_CREATED)
        with patch("app.signals._fire_async"):
            ContentItem.objects.create(
                module=self.module, title="New", type=ContentItem.ContentType.VIDEO,
                provider="youtube", embed_url="https://www.youtube.com/embed/ZToicYcHIOU",
            )
        listed = {s["id"]: s for s in self.client.get("/api/surveys/").data}
        self.assertTrue(listed[self.survey.pk]["is_unlocked"])
        self.assertTrue(listed[self.survey.pk]["has_responded"])
        resp = self._submit({"q1": 0, "q13": "Again."})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already submitted", resp.data["detail"])


class SurveyExportTests(APITestCase):
    def setUp(self):
        import csv as _csv
        self._csv = _csv
        self.admin = User.objects.create_user(email="admin@test.local", password="testpass", role=User.Role.ADMIN)
        self.student = User.objects.create_user(email="s@test.local", password="testpass", full_name="Sam Student")
        cohort = _cohort(10)
        Enrollment.objects.create(user=self.student, cohort=cohort)
        with patch("app.signals._fire_async"):
            self.w1 = Module.objects.create(week_number=1, title="W1", is_published=True)
            self.w2 = Module.objects.create(week_number=2, title="W2", is_published=True)
        _drop_auto_surveys(self.w1, self.w2)
        questions = [{"id": "q1", "type": "integer"}, {"id": "q13", "type": "longtext"}]
        self.s1 = Survey.objects.create(module=self.w1, code="wk1", title="Week 1", type="weekly", questions=questions)
        self.s2 = Survey.objects.create(module=self.w2, code="wk2", title="Week 2", type="weekly", questions=questions)
        SurveyResponse.objects.create(user=self.student, survey=self.s1, answers={"q1": 3, "q13": "=HYPERLINK(\"x\")"})
        SurveyResponse.objects.create(user=self.student, survey=self.s2, answers={"q1": 0, "q13": "Calm 😊"})

    def _rows(self, resp):
        text = resp.content.decode("utf-8").lstrip("﻿")
        return list(self._csv.DictReader(text.splitlines()))

    def test_admin_downloads_all_responses_without_identity_by_default(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/api/surveys/export/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn('filename="survey-responses-all-', resp["Content-Disposition"])
        rows = self._rows(resp)
        self.assertEqual([r["survey_code"] for r in rows], ["wk1", "wk2"])
        self.assertEqual(rows[0]["participant_id"], str(self.student.pk))
        self.assertEqual(rows[0]["cohort"], "Cohort 10")
        self.assertEqual(rows[1]["q13"], "Calm 😊")
        self.assertNotIn("email", rows[0])
        self.assertNotIn("s@test.local", resp.content.decode("utf-8"))

    def test_identify_adds_name_and_email(self):
        self.client.force_login(self.admin)
        rows = self._rows(self.client.get("/api/surveys/export/?identify=1"))
        self.assertEqual(rows[0]["email"], "s@test.local")
        self.assertEqual(rows[0]["full_name"], "Sam Student")

    def test_formula_like_answers_are_neutralised(self):
        self.client.force_login(self.admin)
        rows = self._rows(self.client.get("/api/surveys/export/"))
        self.assertEqual(rows[0]["q13"], "'=HYPERLINK(\"x\")")

    def test_single_survey_filter_and_unknown_survey(self):
        self.client.force_login(self.admin)
        resp = self.client.get(f"/api/surveys/export/?survey={self.s2.pk}")
        self.assertIn('filename="survey-responses-wk2-', resp["Content-Disposition"])
        self.assertEqual([r["survey_code"] for r in self._rows(resp)], ["wk2"])
        self.assertEqual(self.client.get("/api/surveys/export/?survey=999").status_code, status.HTTP_404_NOT_FOUND)

    def test_students_cannot_export(self):
        self.client.force_login(self.student)
        self.assertEqual(self.client.get("/api/surveys/export/").status_code, status.HTTP_403_FORBIDDEN)
        self.client.logout()
        self.assertIn(self.client.get("/api/surveys/export/").status_code, (401, 403))


class SurveyAutoCreationTests(TestCase):
    """Signal auto-creates one weekly survey when a Module is first saved."""

    def test_survey_created_on_module_creation(self):
        module = Module.objects.create(week_number=80, title="Week 80", is_published=False)
        survey = Survey.objects.get(module=module, type=SurveyType.WEEKLY)
        self.assertEqual(survey.title, "Week 80")
        self.assertEqual(survey.code, "weekly-w80")
        from app.survey_template import STANDARD_WEEKLY_QUESTIONS
        self.assertEqual(survey.questions, STANDARD_WEEKLY_QUESTIONS)

    def test_survey_not_duplicated_on_module_update(self):
        module = Module.objects.create(week_number=81, title="Week 81")
        module.title = "Week 81 Updated"
        module.save()
        self.assertEqual(
            Survey.objects.filter(module=module, type=SurveyType.WEEKLY).count(), 1
        )

    def test_no_survey_for_week0_introduction(self):
        module = Module.objects.create(week_number=0, title="Module 0 - Introduction")
        self.assertFalse(Survey.objects.filter(module=module).exists())

    def test_signal_skips_when_raw(self):
        """Signal handler must do nothing when raw=True (fixture loading path)."""
        module = Module.objects.create(week_number=82, title="Week 82")
        Survey.objects.filter(module=module, type=SurveyType.WEEKLY).delete()

        from app.signals import create_weekly_survey
        create_weekly_survey(
            sender=Module, instance=module, created=True, raw=True,
            using="default", update_fields=None,
        )
        self.assertFalse(Survey.objects.filter(module=module, type=SurveyType.WEEKLY).exists())

    def test_auto_created_survey_unlocks_after_module_complete(self):
        """The auto-created survey obeys the same unlock rule as manually created ones."""
        from rest_framework.test import APIClient

        # Week 1 so the module is open for a cohort that has already started.
        module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        item = ContentItem.objects.create(
            module=module, title="Video", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/x",
        )
        survey = Survey.objects.get(module=module, type=SurveyType.WEEKLY)

        user = User.objects.create_user(email="autocreate@test.local", password="pass")
        Enrollment.objects.create(user=user, cohort=_cohort(3))
        client = APIClient()
        client.force_login(user)

        resp = client.get("/api/surveys/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        survey_data = next(s for s in resp.data if s["id"] == survey.pk)
        self.assertFalse(survey_data["is_unlocked"])

        ContentCompletion.objects.create(user=user, content_item=item)
        resp2 = client.get("/api/surveys/")
        survey_data2 = next(s for s in resp2.data if s["id"] == survey.pk)
        self.assertTrue(survey_data2["is_unlocked"])


class OrphanedSurveyTests(APITestCase):
    """Orphaned weekly surveys (module=None) are hidden from students, not admins."""

    def setUp(self):
        self.student = User.objects.create_user(email="orphan_student@test.local", password="pass")
        self.admin = User.objects.create_user(
            email="orphan_admin@test.local", password="pass", role=User.Role.ADMIN,
        )
        _enroll(self.student)

    def test_orphaned_weekly_survey_hidden_from_students(self):
        orphan = Survey(code="orphan-hide-1", title="Orphan", type="weekly", questions=[])
        orphan.save()

        self.client.force_login(self.student)
        resp = self.client.get("/api/surveys/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertNotIn(orphan.pk, [s["id"] for s in resp.data])

    def test_orphaned_weekly_survey_visible_to_admins(self):
        orphan = Survey(code="orphan-hide-2", title="Orphan Admin", type="weekly", questions=[])
        orphan.save()

        self.client.force_login(self.admin)
        resp = self.client.get("/api/surveys/")
        self.assertIn(orphan.pk, [s["id"] for s in resp.data])

    def test_non_weekly_orphan_still_visible_to_students(self):
        """Intake/end/followup surveys with no module are NOT hidden."""
        global_survey = Survey.objects.create(
            code="global-intake-orphan", title="Intake", type="intake", questions=[],
        )
        self.client.force_login(self.student)
        resp = self.client.get("/api/surveys/")
        self.assertIn(global_survey.pk, [s["id"] for s in resp.data])

    def test_orphaned_survey_responses_preserved(self):
        """SurveyResponse rows survive when a module FK becomes NULL (SET_NULL)."""
        module = Module.objects.create(week_number=84, title="Week 84", is_published=True)
        survey = Survey.objects.get(module=module, type=SurveyType.WEEKLY)
        SurveyResponse.objects.create(user=self.student, survey=survey, answers={})

        Survey.objects.filter(pk=survey.pk).update(module=None)

        self.assertTrue(SurveyResponse.objects.filter(user=self.student, survey=survey).exists())


class SeedSurveysCommandTests(TestCase):
    """seed_surveys management command backfills and is idempotent."""

    def test_seed_creates_missing_surveys(self):
        module = Module.objects.create(week_number=85, title="Week 85")
        Survey.objects.filter(module=module, type=SurveyType.WEEKLY).delete()

        out = StringIO()
        call_command("seed_surveys", stdout=out)

        self.assertTrue(Survey.objects.filter(module=module, type=SurveyType.WEEKLY).exists())
        self.assertIn("1", out.getvalue())

    def test_seed_recognises_auto_created_surveys(self):
        """Running seed_surveys after the signal already ran must not duplicate."""
        module = Module.objects.create(week_number=86, title="Week 86")
        self.assertEqual(Survey.objects.filter(module=module, type=SurveyType.WEEKLY).count(), 1)

        call_command("seed_surveys", stdout=StringIO())

        self.assertEqual(Survey.objects.filter(module=module, type=SurveyType.WEEKLY).count(), 1)

    def test_seed_recognises_fixture_style_surveys(self):
        """seed_surveys counts a survey created with the old 'weekly-maq-wN' code as present."""
        module = Module.objects.create(week_number=87, title="Week 87")
        Survey.objects.filter(module=module, type=SurveyType.WEEKLY).delete()
        Survey.objects.create(
            module=module, code="weekly-maq-w87", title="Week 87",
            type="weekly", questions=[],
        )

        call_command("seed_surveys", stdout=StringIO())

        self.assertEqual(Survey.objects.filter(module=module, type=SurveyType.WEEKLY).count(), 1)


class SurveyTitleSyncTests(TestCase):
    """pre_save signal keeps the survey title in sync when week_number is changed."""

    def test_title_updated_when_week_number_changes(self):
        module = Module.objects.create(week_number=88, title="Week 88")
        survey = Survey.objects.get(module=module, type=SurveyType.WEEKLY)
        self.assertEqual(survey.title, "Week 88")

        module.week_number = 89
        module.save()

        survey.refresh_from_db()
        self.assertEqual(survey.title, "Week 89")

    def test_custom_title_not_overwritten(self):
        module = Module.objects.create(week_number=90, title="Week 90")
        survey = Survey.objects.get(module=module, type=SurveyType.WEEKLY)
        survey.title = "Custom Title"
        survey.save()

        module.week_number = 91
        module.save()

        survey.refresh_from_db()
        self.assertEqual(survey.title, "Custom Title")

    def test_code_never_changed_on_reorder(self):
        module = Module.objects.create(week_number=92, title="Week 92")
        survey = Survey.objects.get(module=module, type=SurveyType.WEEKLY)
        original_code = survey.code

        module.week_number = 93
        module.save()

        survey.refresh_from_db()
        self.assertEqual(survey.code, original_code)


class SurveyAdminTests(APITestCase):
    QUESTIONS = [
        {"id": "q1", "type": "integer", "text": "How many times?", "unit": "times", "section": "Formal practice"},
        {"id": "q2", "type": "likert", "text": "How focused?", "min": 0, "max": 6,
         "scale_labels": {"0": "Never", "6": "Always"}, "skip_if": {"question_id": "q1", "value": 0}},
        {"id": "q3", "type": "longtext", "text": "Reflect."},
    ]

    def setUp(self):
        self.admin = User.objects.create_user(email="admin@test.local", password="testpass", role=User.Role.ADMIN)
        self.student = User.objects.create_user(email="s@test.local", password="testpass", full_name="Sam Student")
        Enrollment.objects.create(user=self.student, cohort=_cohort(10))
        with patch("app.signals._fire_async"):
            self.w1 = Module.objects.create(week_number=1, title="W1", is_published=True)
            self.w2 = Module.objects.create(week_number=2, title="W2", is_published=True)
        _drop_auto_surveys(self.w1, self.w2)
        self.survey = Survey.objects.create(
            module=self.w1, code="wk1", title="Week 1", type="weekly", questions=self.QUESTIONS,
        )
        self.client.force_login(self.admin)

    def _questions(self, **changes):
        import copy
        qs = copy.deepcopy(self.QUESTIONS)
        for index, fields in changes.items():
            qs[int(index[1:])].update(fields)
        return qs

    def _respond(self):
        return SurveyResponse.objects.create(
            user=self.student, survey=self.survey, answers={"q1": 2, "q2": 4, "q3": "Calm"},
        )

    def test_manage_lists_surveys_with_questions_and_response_counts(self):
        self._respond()
        resp = self.client.get("/api/surveys/manage/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data[0]["response_count"], 1)
        self.assertEqual(resp.data[0]["questions"], self.QUESTIONS)

    def test_admin_creates_survey(self):
        resp = self.client.post("/api/surveys/", {
            "code": "wk2", "title": "Week 2", "type": "weekly", "module": self.w2.pk, "questions": self.QUESTIONS,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(Survey.objects.get(code="wk2").questions, self.QUESTIONS)

    def test_second_weekly_survey_for_module_is_rejected(self):
        resp = self.client.post("/api/surveys/", {
            "code": "wk1b", "title": "Week 1 again", "type": "weekly", "module": self.w1.pk,
            "questions": self.QUESTIONS,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("module", resp.data)

    def test_weekly_survey_needs_module(self):
        resp = self.client.post("/api/surveys/", {
            "code": "wk9", "title": "Week 9", "type": "weekly", "questions": self.QUESTIONS,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("module", resp.data)

    def test_invalid_questions_are_rejected(self):
        bad = [
            [],
            [{"id": "q1", "type": "integer", "text": ""}],
            [{"id": "q1", "type": "rating", "text": "x"}],
            [{"id": "q1", "type": "likert", "text": "x", "min": 6, "max": 0}],
            [{"id": "q1", "type": "integer", "text": "x"}, {"id": "q1", "type": "integer", "text": "y"}],
            [{"id": "q2", "type": "integer", "text": "x", "skip_if": {"question_id": "q9", "value": 0}}],
            [{"id": "q1", "type": "integer", "text": "x", "colour": "red"}],
            [{"id": "bad id!", "type": "integer", "text": "x"}],
        ]
        for questions in bad:
            with self.subTest(questions=questions):
                resp = self.client.patch(f"/api/surveys/{self.survey.pk}/", {"questions": questions}, format="json")
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.survey.refresh_from_db()
        self.assertEqual(self.survey.questions, self.QUESTIONS)

    def test_wording_is_editable_after_responses(self):
        self._respond()
        questions = self._questions(q0={"text": "How often?", "section": "New heading"}, q2={"text": "Write."})
        resp = self.client.patch(
            f"/api/surveys/{self.survey.pk}/", {"title": "Week one", "questions": questions}, format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.survey.refresh_from_db()
        self.assertEqual(self.survey.title, "Week one")
        self.assertEqual(self.survey.questions[0]["text"], "How often?")

    def test_structure_is_frozen_after_responses(self):
        self._respond()
        changes = [
            self.QUESTIONS[:2],
            self.QUESTIONS + [{"id": "q4", "type": "longtext", "text": "More?"}],
            list(reversed(self.QUESTIONS)),
            self._questions(q1={"max": 10}),
            self._questions(q0={"type": "longtext"}),
        ]
        for questions in changes:
            with self.subTest(questions=questions):
                resp = self.client.patch(f"/api/surveys/{self.survey.pk}/", {"questions": questions}, format="json")
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        resp = self.client.patch(f"/api/surveys/{self.survey.pk}/", {"module": self.w2.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_structure_is_editable_before_responses(self):
        questions = self.QUESTIONS + [{"id": "q4", "type": "longtext", "text": "More?"}]
        resp = self.client.patch(f"/api/surveys/{self.survey.pk}/", {"questions": questions}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_delete_only_without_responses(self):
        self._respond()
        resp = self.client.delete(f"/api/surveys/{self.survey.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Survey.objects.filter(pk=self.survey.pk).exists())
        SurveyResponse.objects.all().delete()
        self.assertEqual(self.client.delete(f"/api/surveys/{self.survey.pk}/").status_code, status.HTTP_204_NO_CONTENT)

    def test_responses_lists_answers_with_identity_and_cohort(self):
        self._respond()
        resp = self.client.get(f"/api/surveys/{self.survey.pk}/responses/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data[0]["email"], "s@test.local")
        self.assertEqual(resp.data[0]["cohort"], "Cohort 10")
        self.assertEqual(resp.data[0]["answers"]["q2"], 4)

    def test_students_cannot_manage(self):
        self.client.force_login(self.student)
        pk = self.survey.pk
        self.assertEqual(self.client.get("/api/surveys/manage/").status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.get(f"/api/surveys/{pk}/responses/").status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.patch(f"/api/surveys/{pk}/", {"title": "x"}, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(self.client.delete(f"/api/surveys/{pk}/").status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.get("/api/surveys/export/").status_code, status.HTTP_403_FORBIDDEN)
        # Reading surveys is unchanged for participants.
        self.assertEqual(self.client.get(f"/api/surveys/{pk}/").status_code, status.HTTP_200_OK)

    def test_unsafe_codes_are_rejected(self):
        for code in ('wk"1', "wk\n1", "wk/1", "../x", "wk 1"):
            with self.subTest(code=code):
                resp = self.client.patch(f"/api/surveys/{self.survey.pk}/", {"code": code}, format="json")
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_export_filename_is_safe_for_legacy_codes(self):
        # Codes written before validation existed (e.g. via fixtures) must not break the header.
        Survey.objects.filter(pk=self.survey.pk).update(code='wk"1\n')
        resp = self.client.get(f"/api/surveys/export/?survey={self.survey.pk}")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('filename="survey-responses-wk_1_-', resp["Content-Disposition"])

    def test_create_requires_questions(self):
        resp = self.client.post("/api/surveys/", {"code": "x", "title": "x", "type": "intake"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("questions", resp.data)

    def test_question_edge_cases_are_rejected_not_crashing(self):
        integer = {"id": "q1", "type": "integer", "text": "x"}
        bad = [
            [{"id": f"q{i}", "type": "integer", "text": "x"} for i in range(101)],
            [{"id": "q1", "type": "integer", "text": "a\x00b"}],
            [{"id": "q1", "type": "longtext", "text": "x", "min": 0}],
            [{"id": "q1", "type": "likert", "text": "x", "min": 0, "max": 6, "unit": "kg"}],
            [integer, {"id": "q2", "type": "integer", "text": "y", "skip_if": {"question_id": ["q1"], "value": 0}}],
            [integer, {"id": "q2", "type": "integer", "text": "y", "skip_if": {"question_id": {}, "value": 0}}],
        ]
        for questions in bad:
            with self.subTest(questions=str(questions)[:80]):
                resp = self.client.patch(f"/api/surveys/{self.survey.pk}/", {"questions": questions}, format="json")
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_staff_flag_follows_role(self):
        # is_staff is derived from role on save, so only admins can manage surveys.
        user = User.objects.create_user(email="staff@test.local", password="testpass", is_staff=True)
        self.client.force_login(user)
        self.assertEqual(self.client.get("/api/surveys/manage/").status_code, status.HTTP_403_FORBIDDEN)

    def test_manage_query_count_is_constant(self):
        for week in range(3, 13):
            with patch("app.signals._fire_async"):
                module = Module.objects.create(week_number=week, title=f"W{week}", is_published=True)
            _drop_auto_surveys(module)
            Survey.objects.create(module=module, code=f"wk{week}", title="x", type="weekly", questions=self.QUESTIONS)
        with self.assertNumQueries(4):
            self.client.get("/api/surveys/manage/")
