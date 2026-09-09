from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import ContentCompletion, ContentItem, Module, Survey, SurveyResponse

User = get_user_model()


class ModuleListTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass"
        )
        self.published = Module.objects.create(
            week_number=1, title="Week 1 — Published", is_published=True
        )
        self.unpublished = Module.objects.create(
            week_number=2, title="Week 2 — Unpublished", is_published=False
        )
        # Create items with reversed insertion order to prove sorting isn't insertion-order
        ContentItem.objects.create(
            module=self.published,
            title="Second item",
            type="audio",
            provider="soundcloud",
            embed_url="https://soundcloud.com/x/y",
            display_order=2,
        )
        ContentItem.objects.create(
            module=self.published,
            title="First item",
            type="video",
            provider="youtube",
            embed_url="https://www.youtube.com/embed/x",
            display_order=1,
        )

    def test_unpublished_module_excluded(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/modules/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        returned_ids = [m["id"] for m in resp.data]
        self.assertIn(self.published.pk, returned_ids)
        self.assertNotIn(self.unpublished.pk, returned_ids)

    def test_content_items_nested_and_ordered_by_display_order(self):
        self.client.force_login(self.student)
        resp = self.client.get(f"/api/modules/{self.published.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        items = resp.data["content_items"]
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["display_order"], 1)
        self.assertEqual(items[0]["title"], "First item")
        self.assertEqual(items[1]["display_order"], 2)
        self.assertEqual(items[1]["title"], "Second item")


class ContentCompletionTests(APITestCase):
    def setUp(self):
        self.student1 = User.objects.create_user(
            email="s1@test.local", password="testpass"
        )
        self.student2 = User.objects.create_user(
            email="s2@test.local", password="testpass"
        )
        module = Module.objects.create(
            week_number=1, title="Week 1", is_published=True
        )
        self.item = ContentItem.objects.create(
            module=module,
            title="Intro video",
            type="video",
            provider="youtube",
            embed_url="https://www.youtube.com/embed/x",
            display_order=1,
        )

    def test_completion_attaches_to_requesting_user_not_payload(self):
        self.client.force_login(self.student1)
        resp = self.client.post(
            "/api/progress/",
            # Attempt to spoof: send student2's PK in the payload.
            # The viewset must ignore it and use request.user.
            {"content_item": self.item.pk, "user": self.student2.pk},
        )
        self.assertIn(resp.status_code, [status.HTTP_200_OK, status.HTTP_201_CREATED])
        completion = ContentCompletion.objects.get(pk=resp.data["id"])
        self.assertEqual(completion.user_id, self.student1.pk)

    def test_repeat_post_is_idempotent(self):
        self.client.force_login(self.student1)
        payload = {"content_item": self.item.pk}
        resp1 = self.client.post("/api/progress/", payload)
        resp2 = self.client.post("/api/progress/", payload)
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        # Exactly one row must exist — no duplicate created
        self.assertEqual(
            ContentCompletion.objects.filter(
                user=self.student1, content_item=self.item
            ).count(),
            1,
        )

    def test_student_cannot_read_another_students_completions(self):
        # student2 has a completion; student1 lists /api/progress/ and must see nothing
        ContentCompletion.objects.create(user=self.student2, content_item=self.item)
        self.client.force_login(self.student1)
        resp = self.client.get("/api/progress/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 0)


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
        self.module = Module.objects.create(
            week_number=1, title="Week 1", is_published=True
        )
        self.item = ContentItem.objects.create(
            module=self.module, title="Intro video", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/x",
        )
        self.survey = Survey.objects.create(
            module=self.module,
            code="test-weekly",
            title="Test Weekly Survey",
            type="weekly",
            questions=self.QUESTIONS,
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
        """A weekly survey with module=null bypasses clean() but must not be unlocked."""
        # Use save() directly to skip clean() — simulates loaddata fixture behaviour.
        orphan = Survey(code="orphan-weekly", title="Orphan", type="weekly", questions=[])
        orphan.save()
        self.client.force_login(self.student)
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
        other_survey = Survey.objects.create(
            module=other_module, code="w2-survey", title="Week 2 Survey",
            type="weekly", questions=self.QUESTIONS,
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
        "q13": "Feeling more present and calm.",
        "q14": "Regular practice helped me stay focused.",
    }

    def setUp(self):
        self.student = User.objects.create_user(
            email="fixture_student@test.local",
            password="testpass",
            full_name="Fixture Student",
        )

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
