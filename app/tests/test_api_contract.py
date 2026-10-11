"""API responses match the TypeScript types the frontend reads them with.

The types in client/src/types/ and client/src/lib/api.ts are written by hand. These tests call each
endpoint the frontend uses and compare the JSON with the type, both ways: a field the type requires
but the API doesn't send, a field the API sends that the type doesn't declare, or a value of the
wrong kind all fail here instead of as `undefined` somewhere in the UI.
"""

from datetime import date, timedelta
from unittest.mock import patch

from ..models import (
    AdditionalResource,
    Cohort,
    ContentCompletion,
    ContentItem,
    Enrollment,
    ForumFlag,
    ForumPost,
    ForumThread,
    Module,
    NotificationPreference,
    Survey,
    SurveyResponse,
    SurveyType,
)
from .base import APITestCase, User
from .ts_types import TypeScriptTypes, mismatches

TS = TypeScriptTypes()


@patch("app.signals._fire_async")
class ApiContractTests(APITestCase):
    def setUp(self):
        today = date.today()
        self.cohort = Cohort.objects.create(
            name="Term 4", year=today.year, start_date=today - timedelta(days=30), end_date=today + timedelta(days=30),
        )
        self.student = User.objects.create_user(
            email="student@test.local", password="Calm-River-42", full_name="Sam Student", display_name="Sam",
        )
        self.admin = User.objects.create_user(email="admin@test.local", password="Calm-River-42", role=User.Role.ADMIN)
        Enrollment.objects.create(user=self.student, cohort=self.cohort, status=Enrollment.Status.ACTIVE)
        with patch("app.signals._fire_async"):
            self.module = Module.objects.create(
                week_number=1, title="Body Scan", description="Notice the body.", summary="Week one", is_published=True,
            )
            self.item = ContentItem.objects.create(
                module=self.module, title="Guided body scan", type="audio", provider="youtube",
                embed_url="https://www.youtube.com/embed/uaRFzaBehB4",
            )
        self.survey = Survey.objects.get(module=self.module, type=SurveyType.WEEKLY)
        ContentCompletion.objects.create(user=self.student, content_item=self.item)
        SurveyResponse.objects.create(user=self.student, survey=self.survey, answers={"q1": 2, "q13": "Calm"})
        self.client.force_authenticate(self.student)
        self.client.post("/api/forum/accept-rules/")
        self.thread = ForumThread.objects.create(created_by=self.student, title="Hello", module=self.module)
        head = ForumPost.objects.create(thread=self.thread, author=self.student, body="Hi all", is_head_post=True)
        ForumPost.objects.create(thread=self.thread, author=self.student, body="A reply", parent_post=head)
        NotificationPreference.objects.create(user=self.student)
        AdditionalResource.objects.create(category="book", title="Calm", author="A", url="https://example.com")

    def assertMatches(self, response, type_expr):
        self.assertLess(response.status_code, 300, response.content[:300])
        problems = mismatches(response.json(), TS.parse(type_expr))
        self.assertEqual(problems, [], f"{response.request['PATH_INFO']} doesn't match {type_expr}")

    # ── Student-facing ──────────────────────────────────────────────────────────

    def test_auth(self, _fire):
        self.client.force_authenticate(None)
        login = self.client.post("/api/login/", {"email": "student@test.local", "password": "Calm-River-42"}, format="json")
        self.assertMatches(login, "{ message: string; token: string; user: AuthUser }")

        self.client.force_authenticate(self.student)
        self.assertMatches(self.client.get("/api/user/"), "{ user: AuthUser }")
        self.assertMatches(
            self.client.patch("/api/profile/", {"display_name": "Sammy"}, format="json"),
            "{ message: string; user: AuthUser }",
        )

    def test_modules_and_progress(self, _fire):
        self.client.force_authenticate(self.student)
        self.assertMatches(self.client.get("/api/modules/"), "ApiModule[]")
        self.assertMatches(self.client.get(f"/api/modules/{self.module.pk}/"), "ApiModuleDetail")
        self.assertMatches(self.client.get("/api/progress/"), "ApiContentCompletion[]")
        self.assertMatches(self.client.post("/api/content-views/", {"module": self.module.pk}, format="json"), "ApiModuleView")
        self.assertMatches(self.client.get("/api/content-views/"), "ApiModuleView[]")
        self.client.force_authenticate(None)
        self.assertMatches(self.client.get("/api/modules/summary/"), "ApiModuleSummary[]")

    def test_surveys(self, _fire):
        self.client.force_authenticate(self.student)
        self.assertMatches(self.client.get("/api/surveys/"), "ApiSurvey[]")
        self.assertMatches(self.client.get(f"/api/surveys/{self.survey.pk}/"), "ApiSurveyDetail")

    def test_forum(self, _fire):
        self.client.force_authenticate(self.student)
        self.assertMatches(self.client.get("/api/forum/threads/"), "Page<ForumThread>")
        self.assertMatches(self.client.get(f"/api/forum/threads/{self.thread.pk}/"), "ForumThreadDetail")
        self.assertMatches(self.client.post("/api/forum/threads/", {"body": "New thread"}, format="json"), "ForumThread")
        self.assertMatches(
            self.client.post("/api/forum/posts/", {"thread": self.thread.pk, "body": "Another"}, format="json"),
            "ForumPost",
        )

    def test_forum_rules(self, _fire):
        self.client.force_authenticate(self.student)
        self.assertMatches(self.client.get("/api/forum/rules/"), "ForumRules")
        self.client.force_authenticate(self.admin)
        self.assertMatches(
            self.client.post("/api/forum/rules/", {"rules": [{"title": "Be kind", "body": ""}]}, format="json"),
            "ForumRules",
        )

    def test_notification_preferences(self, _fire):
        self.client.force_authenticate(self.student)
        self.assertMatches(self.client.get("/api/notifications/preferences/me/"), "NotificationPreferences")

    # ── Admin portal ────────────────────────────────────────────────────────────

    def test_admin_users(self, _fire):
        self.client.force_authenticate(self.admin)
        self.assertMatches(self.client.get("/api/users/"), "Page<AdminUser>")
        self.assertMatches(self.client.get(f"/api/users/{self.student.pk}/overview/"), "UserOverview")

    def test_admin_forum_moderation(self, _fire):
        other = User.objects.create_user(email="other@test.local", password="Calm-River-42")
        reply = ForumPost.objects.filter(thread=self.thread, is_head_post=False).get()
        ForumFlag.objects.create(post=reply, flagged_by=other, reason="Unkind")
        self.client.force_authenticate(self.admin)
        self.assertMatches(self.client.get("/api/forum/posts/reported/"), "Page<ReportedPost>")
        self.assertMatches(
            self.client.post(f"/api/forum/posts/{reply.pk}/moderate/", {"action": "ban", "ban_days": 7}, format="json"),
            "ModeratedPost",
        )
        self.assertMatches(self.client.get("/api/forum/posts/removed/"), "Page<ModeratedPost>")
        self.assertMatches(self.client.post(f"/api/forum/posts/{reply.pk}/restore/"), "ModeratedPost")
        self.assertMatches(self.client.get("/api/users/?forum_banned=true"), "Page<AdminUser>")
        self.assertMatches(self.client.delete(f"/api/users/{self.student.pk}/forum-ban/"), "AdminUser")

    def test_admin_cohorts_and_enrollments(self, _fire):
        self.client.force_authenticate(self.admin)
        self.assertMatches(self.client.get("/api/cohorts/"), "Cohort[]")
        self.assertMatches(self.client.get("/api/enrollments/"), "Page<Enrollment>")

    def test_admin_modules(self, _fire):
        self.client.force_authenticate(self.admin)
        self.assertMatches(self.client.get("/api/modules/"), "AdminModule[]")
        self.assertMatches(self.client.get(f"/api/modules/{self.module.pk}/"), "AdminModule")
        self.assertMatches(self.client.get(f"/api/modules/{self.module.pk}/progress/"), "ModuleProgress")

    def test_admin_dashboard_and_resources(self, _fire):
        self.client.force_authenticate(self.admin)
        self.assertMatches(self.client.get("/api/dashboard/stats/"), "DashboardStats")
        self.assertMatches(self.client.get("/api/additional-resources/"), "AdminAdditionalResource[]")

    def test_admin_surveys(self, _fire):
        self.client.force_authenticate(self.admin)
        self.assertMatches(self.client.get("/api/surveys/manage/"), "AdminSurvey[]")
        self.assertMatches(self.client.get(f"/api/surveys/{self.survey.pk}/responses/"), "AdminSurveyResponse[]")


class TypeScriptTypeParserTests(APITestCase):
    """The checker itself, so a parsing slip can't make every contract test pass vacuously."""

    def test_reads_required_optional_and_nested_fields(self):
        shape = TS["AuthUser"]
        self.assertEqual(shape.kind, "object")
        self.assertFalse(shape.fields["email"][0])
        self.assertTrue(shape.fields["display_name"][0])
        self.assertTrue(shape.fields["cohort_start_date"][1].nullable)
        by_cohort = TS["DashboardStats"].fields["by_cohort"][1]
        self.assertEqual(by_cohort.kind, "array")
        self.assertIn("withdrawn", by_cohort.item.fields)

    def test_follows_intersections_and_references(self):
        detail = TS["ForumThreadDetail"]
        self.assertIn("reply_count", detail.fields)  # from ForumThread
        self.assertEqual(detail.fields["replies"][1].item.fields.keys(), TS["ForumPost"].fields.keys())

    def test_reports_each_kind_of_mismatch(self):
        shape = TS.parse("{ id: number; name: string; tags?: string[]; owner: { id: number } | null }")
        self.assertEqual(mismatches({"id": 1, "name": "x", "owner": None}, shape), [])
        problems = mismatches({"id": "1", "extra": True, "tags": [3], "owner": {"id": 2}}, shape)
        self.assertEqual(problems, [
            "response.extra is in the response but not in the TypeScript type",
            "response.id should be a number, got str '1'",
            "response.name is required by the TypeScript type but missing from the response",
            "response.tags[0] should be a string, got int 3",
        ])
        self.assertEqual(mismatches(None, shape), ["response is null but the type doesn't allow null"])
