"""Admin portal API: cohorts, users, approvals, resources, modules, stats and password resets."""

from datetime import date, timedelta
from unittest.mock import patch

from rest_framework import status

from ..models import (
    AdditionalResource,
    AuthToken,
    Cohort,
    ContentCompletion,
    ContentItem,
    Enrollment,
    ForumPost,
    ForumThread,
    Module,
    NotificationLog,
    Survey,
    SurveyResponse,
    SurveyType,
)
from .base import User, APITestCase, _enroll, _cohort


class CohortAdminTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass",
        )
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )

    def test_student_cannot_create_cohort(self):
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/cohorts/",
            {"name": "Sem2 2026", "year": 2026, "start_date": "2026-07-20", "end_date": "2026-09-14"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_create_update_and_delete_cohort(self):
        self.client.force_login(self.admin)
        create_resp = self.client.post(
            "/api/cohorts/",
            {"name": "Sem2 2026", "year": 2026, "start_date": "2026-07-20", "end_date": "2026-09-14"},
            content_type="application/json",
        )
        self.assertEqual(create_resp.status_code, status.HTTP_201_CREATED)
        cohort_id = create_resp.data["id"]

        update_resp = self.client.patch(
            f"/api/cohorts/{cohort_id}/",
            {"name": "Semester 2 2026"},
            content_type="application/json",
        )
        self.assertEqual(update_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(update_resp.data["name"], "Semester 2 2026")

        delete_resp = self.client.delete(f"/api/cohorts/{cohort_id}/")
        self.assertEqual(delete_resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Cohort.objects.filter(pk=cohort_id).exists())

    def test_cohort_end_date_before_start_date_rejected(self):
        self.client.force_login(self.admin)
        resp = self.client.post(
            "/api/cohorts/",
            {"name": "Bad Cohort", "year": 2026, "start_date": "2026-09-14", "end_date": "2026-07-20"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class UserManagementAdminTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(email="student@test.local", password="testpass")
        self.other = User.objects.create_user(email="other@test.local", password="testpass")
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        _enroll(self.student, self.other)

    def test_student_lists_only_themselves(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/users/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([u["id"] for u in resp.data["results"]], [self.student.pk])
        self.assertNotIn("role", resp.data["results"][0])

    def test_student_cannot_make_themselves_admin(self):
        self.client.force_login(self.student)
        resp = self.client.patch(
            f"/api/users/{self.student.pk}/", {"role": "admin", "display_name": "Me"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.student.refresh_from_db()
        self.assertEqual(self.student.role, User.Role.STUDENT)
        self.assertEqual(self.student.display_name, "Me")

    def test_student_cannot_edit_or_delete_another_user(self):
        self.client.force_login(self.student)
        resp = self.client.patch(
            f"/api/users/{self.other.pk}/", {"display_name": "Hacked"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.delete(f"/api/users/{self.other.pk}/").status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(User.objects.filter(pk=self.other.pk).exists())

    def test_admin_lists_all_users_with_roles(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/api/users/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        by_email = {u["email"]: u for u in resp.data["results"]}
        self.assertEqual(set(by_email), {"student@test.local", "other@test.local", "admin@test.local"})
        self.assertEqual(by_email["admin@test.local"]["role"], "admin")

    def test_admin_can_promote_and_rename_user(self):
        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/users/{self.student.pk}/", {"role": "admin", "full_name": "Renamed"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.student.refresh_from_db()
        self.assertEqual(self.student.role, User.Role.ADMIN)
        self.assertEqual(self.student.full_name, "Renamed")

    def test_admin_invalid_role_rejected(self):
        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/users/{self.student.pk}/", {"role": "superuser"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_cannot_demote_themselves(self):
        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/users/{self.admin.pk}/", {"role": "student"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, User.Role.ADMIN)

    def test_admin_cannot_delete_themselves(self):
        self.client.force_login(self.admin)
        resp = self.client.delete(f"/api/users/{self.admin.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(User.objects.filter(pk=self.admin.pk).exists())

    def test_admin_can_delete_another_user(self):
        self.client.force_login(self.admin)
        resp = self.client.delete(f"/api/users/{self.other.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(User.objects.filter(pk=self.other.pk).exists())


class ApprovalsAdminTests(APITestCase):
    def setUp(self):
        today = date.today()
        self.cohort = Cohort.objects.create(
            name="Current", year=today.year,
            start_date=today - timedelta(days=3), end_date=today + timedelta(days=60),
        )
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.student = User.objects.create_user(email="student@test.local", password="testpass")
        self.module = Module.objects.create(week_number=1, title="Week 1", is_published=True)

    def test_signup_is_enrolled_pending_in_current_cohort(self):
        resp = self.client.post(
            "/api/register/",
            {"email": "new@test.local", "full_name": "New User", "password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        enrollment = Enrollment.objects.get(user__email="new@test.local")
        self.assertEqual(enrollment.cohort, self.cohort)
        self.assertEqual(enrollment.status, Enrollment.Status.PENDING)

    def test_pending_user_sees_no_modules_until_approved(self):
        enrollment = Enrollment.objects.create(
            user=self.student, cohort=self.cohort, status=Enrollment.Status.PENDING,
        )
        self.client.force_login(self.student)
        resp = self.client.get("/api/modules/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("awaiting admin approval", str(resp.data["detail"]))

        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/enrollments/{enrollment.pk}/", {"status": "active"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.client.force_login(self.student)
        modules = self.client.get("/api/modules/").data
        self.assertEqual([m["id"] for m in modules], [self.module.pk])
        self.assertTrue(modules[0]["is_unlocked"])

    def test_admin_filters_enrollments_by_status_and_cohort(self):
        other = User.objects.create_user(email="other@test.local", password="testpass")
        Enrollment.objects.create(user=self.student, cohort=self.cohort, status=Enrollment.Status.PENDING)
        Enrollment.objects.create(user=other, cohort=self.cohort, status=Enrollment.Status.ACTIVE)
        self.client.force_login(self.admin)

        pending = self.client.get("/api/enrollments/?status=pending").data["results"]
        self.assertEqual([e["user_email"] for e in pending], ["student@test.local"])
        in_cohort = self.client.get(f"/api/enrollments/?cohort={self.cohort.pk}").data
        self.assertEqual(in_cohort["count"], 2)

    def test_student_cannot_list_or_approve_enrollments(self):
        enrollment = Enrollment.objects.create(
            user=self.student, cohort=self.cohort, status=Enrollment.Status.PENDING,
        )
        self.client.force_login(self.student)
        self.assertEqual(self.client.get("/api/enrollments/").status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.patch(
            f"/api/enrollments/{enrollment.pk}/", {"status": "active"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        enrollment.refresh_from_db()
        self.assertEqual(enrollment.status, Enrollment.Status.PENDING)

    def test_duplicate_enrollment_in_same_cohort_rejected(self):
        Enrollment.objects.create(user=self.student, cohort=self.cohort)
        self.client.force_login(self.admin)
        resp = self.client.post(
            "/api/enrollments/", {"user": self.student.pk, "cohort": self.cohort.pk},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class AdditionalResourceAdminTests(APITestCase):
    def setUp(self):
        # Start without the rows the seed migration adds, so ordering assertions are exact.
        AdditionalResource.objects.all().delete()
        self.student = User.objects.create_user(email="student@test.local", password="testpass")
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        _enroll(self.student)

    def _create(self, **overrides):
        data = {"category": "book", "title": "Test Book", "author": "A. Writer", "url": "https://example.com/book"}
        data.update(overrides)
        return self.client.post("/api/additional-resources/", data, format="multipart")

    def test_admin_can_create_update_and_delete(self):
        self.client.force_login(self.admin)
        resp = self._create()
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        rid = resp.data["id"]

        resp = self.client.patch(
            f"/api/additional-resources/{rid}/", {"title": "Renamed Book"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["title"], "Renamed Book")

        self.assertEqual(self.client.delete(f"/api/additional-resources/{rid}/").status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(AdditionalResource.objects.filter(pk=rid).exists())

    def test_invalid_category_rejected(self):
        self.client.force_login(self.admin)
        self.assertEqual(self._create(category="podcast").status_code, status.HTTP_400_BAD_REQUEST)

    def test_new_resources_go_to_the_end_of_their_category(self):
        self.client.force_login(self.admin)
        AdditionalResource.objects.create(category="book", title="Old", display_order=4)
        AdditionalResource.objects.create(category="documentary", title="Doc", display_order=9)
        # A client-supplied order is ignored, so it can't collide with an existing slot.
        first = self._create(display_order=0).data
        second = self._create(title="Second").data
        self.assertEqual((first["display_order"], second["display_order"]), (5, 6))
        self.assertEqual(self._create(category="online_program").data["display_order"], 1)

    def test_changing_category_moves_to_the_end_of_the_new_one(self):
        self.client.force_login(self.admin)
        AdditionalResource.objects.create(category="documentary", title="Doc", display_order=3)
        rid = self._create().data["id"]
        resp = self.client.patch(
            f"/api/additional-resources/{rid}/", {"category": "documentary"}, content_type="application/json",
        )
        self.assertEqual(resp.data["display_order"], 4)

    def test_reorder_sets_positions_within_a_category(self):
        a = AdditionalResource.objects.create(category="book", title="A")
        b = AdditionalResource.objects.create(category="book", title="B")
        c = AdditionalResource.objects.create(category="book", title="C")
        doc = AdditionalResource.objects.create(category="documentary", title="Doc", display_order=7)
        self.client.force_login(self.admin)
        resp = self.client.post(
            "/api/additional-resources/reorder/", {"category": "book", "ids": [c.pk, a.pk, b.pk]}, format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        books = AdditionalResource.objects.filter(category="book")
        self.assertEqual([r.title for r in books], ["C", "A", "B"])
        self.assertEqual([r.display_order for r in books], [1, 2, 3])
        doc.refresh_from_db()
        self.assertEqual(doc.display_order, 7)

    def test_reorder_rejects_incomplete_or_foreign_ids(self):
        a = AdditionalResource.objects.create(category="book", title="A")
        b = AdditionalResource.objects.create(category="book", title="B")
        doc = AdditionalResource.objects.create(category="documentary", title="Doc")
        self.client.force_login(self.admin)
        bad = [
            {"category": "book", "ids": [a.pk]},
            {"category": "book", "ids": [a.pk, a.pk]},
            {"category": "book", "ids": [a.pk, b.pk, doc.pk]},
            {"category": "book", "ids": [a.pk, {"x": 1}]},
            {"category": "book", "ids": "1,2"},
            {"category": "podcast", "ids": []},
        ]
        for data in bad:
            with self.subTest(data=data):
                resp = self.client.post("/api/additional-resources/reorder/", data, format="json")
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_student_cannot_reorder(self):
        a = AdditionalResource.objects.create(category="book", title="A")
        self.client.force_login(self.student)
        resp = self.client.post("/api/additional-resources/reorder/", {"category": "book", "ids": [a.pk]}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_logged_out_visitor_cannot_list_resources(self):
        resp = self.client.get("/api/additional-resources/")
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_student_can_read_and_filter_but_not_write(self):
        AdditionalResource.objects.create(category="documentary", title="Test Doc")
        existing = AdditionalResource.objects.create(category="book", title="Test Book")
        self.client.force_login(self.student)

        docs = self.client.get("/api/additional-resources/?category=documentary").data
        self.assertIn("Test Doc", [r["title"] for r in docs])
        self.assertTrue(all(r["category"] == "documentary" for r in docs))

        self.assertEqual(self._create().status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.patch(
            f"/api/additional-resources/{existing.pk}/", {"title": "x"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.delete(f"/api/additional-resources/{existing.pk}/").status_code, status.HTTP_403_FORBIDDEN,
        )


class ModuleAdminTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass",
        )
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.cohort = Cohort.objects.create(
            name="Test Cohort", year=2024,
            start_date=date(2024, 1, 1), end_date=date(2024, 12, 31),
        )
        Enrollment.objects.create(
            user=self.student, cohort=self.cohort, status=Enrollment.Status.ACTIVE,
        )
        self.published = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        self.unpublished = Module.objects.create(week_number=2, title="Week 2", is_published=False)

    def test_student_cannot_create_module(self):
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/modules/",
            {"week_number": 3, "title": "Week 3"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_create_and_publish_module(self):
        self.client.force_login(self.admin)
        resp = self.client.post(
            "/api/modules/",
            {"week_number": 3, "title": "Week 3", "is_published": True},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Module.objects.get(week_number=3).is_published)

    def test_admin_sees_unpublished_modules_student_does_not(self):
        self.client.force_login(self.admin)
        admin_ids = [m["id"] for m in self.client.get("/api/modules/").data]
        self.assertIn(self.unpublished.pk, admin_ids)

        self.client.logout()
        self.client.force_login(self.student)
        student_ids = [m["id"] for m in self.client.get("/api/modules/").data]
        self.assertNotIn(self.unpublished.pk, student_ids)

    def test_text_content_item_requires_body(self):
        self.client.force_login(self.admin)
        resp = self.client.post(
            "/api/content-items/",
            {"module": self.published.pk, "title": "Notes", "type": "text", "body": ""},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_video_content_item_requires_provider_and_embed_url(self):
        self.client.force_login(self.admin)
        resp = self.client.post(
            "/api/content-items/",
            {"module": self.published.pk, "title": "Intro", "type": "video"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_text_content_items_are_rejected(self):
        # Module text lives in Module.description; content items are video/audio only.
        self.client.force_login(self.admin)
        resp = self.client.post(
            "/api/content-items/",
            {
                "module": self.published.pk,
                "title": "Notes",
                "type": "text",
                "body": "## Welcome\nThis week we cover...",
            },
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(ContentItem.objects.filter(title="Notes").exists())

    def _create_item(self, title):
        return self.client.post(
            "/api/content-items/",
            {
                "module": self.published.pk, "title": title, "type": "video",
                "provider": "youtube", "embed_url": "https://www.youtube.com/embed/ZToicYcHIOU",
            },
            content_type="application/json",
        )

    def test_new_content_item_goes_to_end_of_module(self):
        self.client.force_login(self.admin)
        first = self._create_item("First").data
        second = self._create_item("Second").data
        self.assertLess(first["display_order"], second["display_order"])

    def test_reorder_sets_display_order(self):
        self.client.force_login(self.admin)
        a = self._create_item("A").data["id"]
        b = self._create_item("B").data["id"]
        resp = self.client.post(
            "/api/content-items/reorder/",
            {"module": self.published.pk, "ids": [b, a]},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        ordered = list(self.published.content_items.order_by("display_order").values_list("id", flat=True))
        self.assertEqual(ordered, [b, a])

    def test_admin_reorders_modules_by_renumbering_weeks(self):
        third = Module.objects.create(week_number=5, title="Week 5", is_published=True)
        self.client.force_login(self.admin)
        order = [third.pk, self.published.pk, self.unpublished.pk]
        resp = self.client.post("/api/modules/reorder/", {"ids": order}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        # The same week numbers (1, 2, 5) are reassigned in the new order.
        self.assertEqual(list(Module.objects.values_list("pk", "week_number")), list(zip(order, [1, 2, 5])))

    def test_module_reorder_rejects_bad_ids_and_students(self):
        self.client.force_login(self.admin)
        both = [self.published.pk, self.unpublished.pk]
        for ids in ([self.published.pk], both + [both[0]], both + [999], [both[0], "x"], "1,2"):
            with self.subTest(ids=ids):
                resp = self.client.post("/api/modules/reorder/", {"ids": ids}, format="json")
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Module.objects.get(pk=self.published.pk).week_number, 1)
        self.client.force_login(self.student)
        resp = self.client.post("/api/modules/reorder/", {"ids": both[::-1]}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_logged_out_visitor_can_read_published_summaries(self):
        resp = self.client.get("/api/modules/summary/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([m["week_number"] for m in resp.data], [1])
        self.assertEqual(set(resp.data[0]), {"id", "week_number", "title", "summary"})

    def test_admin_can_set_summary_and_reminder_day(self):
        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/modules/{self.published.pk}/", {"summary": "Short blurb"}, content_type="application/json",
        )
        self.assertEqual(resp.data["summary"], "Short blurb")
        item_id = self._create_item("Audio").data["id"]
        resp = self.client.patch(f"/api/content-items/{item_id}/", {"day_offset": 6}, content_type="application/json")
        self.assertEqual(resp.data["day_offset"], 6)
        resp = self.client.patch(f"/api/content-items/{item_id}/", {"day_offset": 7}, content_type="application/json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reorder_rejects_incomplete_id_list(self):
        self.client.force_login(self.admin)
        a = self._create_item("A").data["id"]
        self._create_item("B")
        resp = self.client.post(
            "/api/content-items/reorder/",
            {"module": self.published.pk, "ids": [a]},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class DashboardStatsTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass",
        )
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.cohort = Cohort.objects.create(
            name="Test Cohort", year=2026,
            start_date=date.today() - timedelta(days=7),
            end_date=date.today() + timedelta(days=49),
        )
        Enrollment.objects.create(user=self.student, cohort=self.cohort, status=Enrollment.Status.ACTIVE)
        self.module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        self.item = ContentItem.objects.create(
            module=self.module, title="Intro", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/x",
        )

    def test_student_cannot_access_dashboard_stats(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/dashboard/stats/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_dashboard_module_completion_pct_correct(self):
        ContentCompletion.objects.create(user=self.student, content_item=self.item)
        self.client.force_login(self.admin)
        resp = self.client.get("/api/dashboard/stats/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        module_stat = next(m for m in resp.data["modules"] if m["id"] == self.module.pk)
        self.assertEqual(module_stat["completed_count"], 1)
        self.assertEqual(module_stat["eligible_count"], 1)
        self.assertEqual(module_stat["completion_pct"], 100.0)

    def test_dashboard_cohort_breakdown_counts(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/api/dashboard/stats/")
        cohort_stat = next(c for c in resp.data["by_cohort"] if c["cohort_id"] == self.cohort.pk)
        self.assertEqual(cohort_stat["enrolled"], 1)
        self.assertEqual(cohort_stat["active"], 1)

    def test_dashboard_enrollment_status_breakdown(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/api/dashboard/stats/")
        self.assertEqual(resp.data["enrollment_status_breakdown"]["active"], 1)
        self.assertEqual(resp.data["total_enrolled"], 1)


class ModuleProgressTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.cohort = Cohort.objects.create(
            name="Running", year=2026,
            start_date=date.today() - timedelta(days=14),
            end_date=date.today() + timedelta(days=42),
        )
        self.future_cohort = Cohort.objects.create(
            name="Upcoming", year=2026,
            start_date=date.today() + timedelta(days=14),
            end_date=date.today() + timedelta(days=70),
        )
        self.done = User.objects.create_user(email="done@test.local", password="pw", full_name="Done")
        self.partial = User.objects.create_user(email="partial@test.local", password="pw", full_name="Partial")
        self.idle = User.objects.create_user(email="idle@test.local", password="pw", full_name="Idle")
        self.later = User.objects.create_user(email="later@test.local", password="pw", full_name="Later")
        self.pending = User.objects.create_user(email="pending@test.local", password="pw")
        for user in (self.done, self.partial, self.idle):
            Enrollment.objects.create(user=user, cohort=self.cohort, status=Enrollment.Status.ACTIVE)
        Enrollment.objects.create(user=self.later, cohort=self.future_cohort, status=Enrollment.Status.ACTIVE)
        Enrollment.objects.create(user=self.pending, cohort=self.cohort, status=Enrollment.Status.PENDING)

        self.module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        self.a = ContentItem.objects.create(
            module=self.module, title="A", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/x",
        )
        self.b = ContentItem.objects.create(
            module=self.module, title="B", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/y",
        )
        ContentCompletion.objects.create(user=self.done, content_item=self.a)
        ContentCompletion.objects.create(user=self.done, content_item=self.b)
        ContentCompletion.objects.create(user=self.partial, content_item=self.a)
        survey = Survey.objects.get(module=self.module, type=SurveyType.WEEKLY)
        SurveyResponse.objects.create(user=self.done, survey=survey, answers={})

    def _get(self, query=""):
        self.client.force_login(self.admin)
        return self.client.get(f"/api/modules/{self.module.pk}/progress/{query}")

    def test_student_cannot_view_progress(self):
        self.client.force_login(self.done)
        resp = self.client.get(f"/api/modules/{self.module.pk}/progress/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_statuses_per_student(self):
        resp = self._get()
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        by_email = {s["email"]: s for s in resp.data["students"]}
        self.assertEqual(by_email["done@test.local"]["status"], "completed")
        self.assertEqual(by_email["partial@test.local"]["status"], "in_progress")
        self.assertEqual(by_email["idle@test.local"]["status"], "not_started")
        self.assertEqual(by_email["later@test.local"]["status"], "locked")
        self.assertEqual(by_email["partial@test.local"]["completed_item_ids"], [self.a.pk])
        self.assertEqual(resp.data["item_count"], 2)

    def test_only_active_students_listed(self):
        emails = {s["email"] for s in self._get().data["students"]}
        self.assertNotIn("pending@test.local", emails)
        self.assertNotIn("admin@test.local", emails)

    def test_survey_submission_reported(self):
        by_email = {s["email"]: s for s in self._get().data["students"]}
        self.assertTrue(by_email["done@test.local"]["survey_submitted"])
        self.assertFalse(by_email["partial@test.local"]["survey_submitted"])

    def test_cohort_filter(self):
        resp = self._get(f"?cohort={self.future_cohort.pk}")
        self.assertEqual([s["email"] for s in resp.data["students"]], ["later@test.local"])


class UserOverviewTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.student = User.objects.create_user(email="stu@test.local", password="pw", full_name="Stu Dent")
        self.cohort = Cohort.objects.create(
            name="Running", year=2026,
            start_date=date.today() - timedelta(days=3),
            end_date=date.today() + timedelta(days=50),
        )
        Enrollment.objects.create(user=self.student, cohort=self.cohort, status=Enrollment.Status.ACTIVE)
        self.week1 = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        self.week2 = Module.objects.create(week_number=2, title="Week 2", is_published=True)
        Module.objects.create(week_number=3, title="Draft", is_published=False)
        self.a = ContentItem.objects.create(
            module=self.week1, title="A", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/x",
        )
        ContentItem.objects.create(
            module=self.week1, title="B", type="video",
            provider="youtube", embed_url="https://www.youtube.com/embed/y",
        )
        ContentCompletion.objects.create(user=self.student, content_item=self.a)
        self.survey = Survey.objects.get(module=self.week1, type=SurveyType.WEEKLY)
        SurveyResponse.objects.create(user=self.student, survey=self.survey, answers={})
        thread = ForumThread.objects.create(created_by=self.student, title="Hello")
        ForumPost.objects.create(thread=thread, author=self.student, body="Hello", is_head_post=True)
        ForumPost.objects.create(thread=thread, author=self.student, body="A reply")
        ForumPost.objects.create(thread=thread, author=self.student, body="Gone", is_deleted=True)

    def _get(self, user=None):
        self.client.force_login(user or self.admin)
        return self.client.get(f"/api/users/{self.student.pk}/overview/")

    def test_student_cannot_view_overview(self):
        self.assertEqual(self._get(self.student).status_code, status.HTTP_403_FORBIDDEN)

    def test_profile_and_enrollment(self):
        data = self._get().data
        self.assertEqual(data["user"]["full_name"], "Stu Dent")
        self.assertEqual([e["cohort_name"] for e in data["enrollments"]], ["Running"])

    def test_module_progress_published_only(self):
        modules = {m["week_number"]: m for m in self._get().data["modules"]}
        self.assertNotIn(3, modules)
        self.assertEqual(modules[1]["status"], "in_progress")
        self.assertEqual((modules[1]["completed_count"], modules[1]["item_count"]), (1, 2))
        self.assertTrue(modules[1]["survey_submitted"])
        # Week 2 opens 7 days after the cohort start, which is still 4 days away.
        self.assertEqual(modules[2]["status"], "locked")

    def test_surveys_marked_submitted(self):
        surveys = {s["id"]: s for s in self._get().data["surveys"]}
        self.assertIsNotNone(surveys[self.survey.pk]["submitted_at"])

    def test_forum_activity_skips_deleted_posts(self):
        forum = self._get().data["forum"]
        self.assertEqual(forum["thread_count"], 1)
        self.assertEqual(forum["post_count"], 1)
        self.assertNotIn("Gone", [p["body"] for p in forum["recent_posts"]])


class LastAdminTests(APITestCase):
    def setUp(self):
        self.a = User.objects.create_user(email="a@test.local", password="testpass", role=User.Role.ADMIN)
        self.b = User.objects.create_user(email="b@test.local", password="testpass", role=User.Role.ADMIN)
        self.staff = User.objects.create_user(email="staff@test.local", password="testpass")
        # save() now derives is_staff from role, so write it directly: this mimics a
        # pre-existing staff-but-not-admin row that hasn't been re-saved since.
        User.objects.filter(pk=self.staff.pk).update(is_staff=True)
        self.staff.refresh_from_db()

    def test_admin_can_demote_another_admin_while_one_remains(self):
        self.client.force_login(self.a)
        resp = self.client.patch(f"/api/users/{self.b.pk}/", {"role": "student"}, content_type="application/json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_last_admin_cannot_be_demoted_or_deleted(self):
        self.b.role = User.Role.STUDENT
        self.b.save()
        # Staff accounts can manage users but aren't role=admin, so they could remove the last admin.
        self.client.force_login(self.staff)
        resp = self.client.patch(f"/api/users/{self.a.pk}/", {"role": "student"}, content_type="application/json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.delete(f"/api/users/{self.a.pk}/").status_code, status.HTTP_403_FORBIDDEN)
        self.a.refresh_from_db()
        self.assertEqual(self.a.role, User.Role.ADMIN)


class EnrollmentEdgeCaseTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="admin@test.local", password="testpass", role=User.Role.ADMIN)
        self.student = User.objects.create_user(email="s@test.local", password="testpass")
        self.old = _cohort(30)
        self.new = _cohort(3)
        self.client.force_login(self.admin)

    def test_second_active_enrollment_rejected(self):
        Enrollment.objects.create(user=self.student, cohort=self.old, status=Enrollment.Status.ACTIVE)
        resp = self.client.post(
            "/api/enrollments/", {"user": self.student.pk, "cohort": self.new.pk, "status": "active"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_approving_pending_when_already_active_elsewhere_rejected(self):
        Enrollment.objects.create(user=self.student, cohort=self.old, status=Enrollment.Status.ACTIVE)
        pending = Enrollment.objects.create(user=self.student, cohort=self.new, status=Enrollment.Status.PENDING)
        resp = self.client.patch(f"/api/enrollments/{pending.pk}/", {"status": "active"}, content_type="application/json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_moving_user_between_cohorts_is_allowed(self):
        enr = Enrollment.objects.create(user=self.student, cohort=self.old, status=Enrollment.Status.ACTIVE)
        resp = self.client.patch(f"/api/enrollments/{enr.pk}/", {"cohort": self.new.pk}, content_type="application/json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_content_update_sends_one_notice_with_two_enrollments(self):
        # Legacy data can still hold two active enrollments; only one notice should go out.
        Enrollment.objects.create(user=self.student, cohort=self.old, status=Enrollment.Status.ACTIVE)
        Enrollment.objects.create(user=self.student, cohort=self.new, status=Enrollment.Status.ACTIVE)
        with patch("app.signals._fire_async"):
            module = Module.objects.create(week_number=1, title="W1", is_published=True)
        from app.notifications import notify_content_update
        notify_content_update(module=module)
        self.assertEqual(
            NotificationLog.objects.filter(user=self.student, type=NotificationLog.NotificationType.CONTENT_UPDATE).count(), 1,
        )


class DashboardModuleCompletionTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="admin@test.local", password="testpass", role=User.Role.ADMIN)
        cohort = Cohort.objects.create(
            name="C", year=2026, start_date=date.today() - timedelta(days=7), end_date=date.today() + timedelta(days=49),
        )
        self.a, self.b, self.c, self.pending = (
            User.objects.create_user(email=f"{n}@test.local", password="testpass") for n in ("a", "b", "c", "p")
        )
        for user in (self.a, self.b, self.c):
            Enrollment.objects.create(user=user, cohort=cohort)
        Enrollment.objects.create(user=self.pending, cohort=cohort, status=Enrollment.Status.PENDING)
        self.client.force_login(self.admin)

    def _module(self, week, items, published=True):
        with patch("app.signals._fire_async"):
            module = Module.objects.create(week_number=week, title=f"W{week}", is_published=published)
            made = [
                ContentItem.objects.create(
                    module=module, title=f"I{week}-{n}", type="video",
                    provider="youtube", embed_url="https://www.youtube.com/embed/x",
                )
                for n in range(items)
            ]
        return module, made

    def _stats(self):
        return {m["id"]: m for m in self.client.get("/api/dashboard/stats/").data["modules"]}

    def _complete(self, user, *items):
        for item in items:
            ContentCompletion.objects.create(user=user, content_item=item)

    def test_counts_only_active_students_who_finished_every_item(self):
        w1, (i1, i2) = self._module(1, 2)
        w2, (j1,) = self._module(2, 1)
        empty, _ = self._module(3, 0)
        hidden, (h1,) = self._module(4, 1, published=False)
        self._complete(self.a, i1, i2, j1)  # finished both
        self._complete(self.b, i1)          # half of week 1
        self._complete(self.c, j1)          # week 2 only
        self._complete(self.pending, i1, i2, j1, h1)  # not active: never counted
        stats = self._stats()
        self.assertEqual(set(stats), {w1.pk, w2.pk, empty.pk})
        self.assertEqual((stats[w1.pk]["completed_count"], stats[w1.pk]["completion_pct"]), (1, 33.3))
        self.assertEqual((stats[w2.pk]["completed_count"], stats[w2.pk]["completion_pct"]), (2, 66.7))
        self.assertEqual((stats[empty.pk]["completed_count"], stats[empty.pk]["eligible_count"]), (0, 3))

    def test_query_count_does_not_grow_with_modules(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        self._module(1, 2)
        with CaptureQueriesContext(connection) as before:
            self._stats()
        for week in range(2, 7):
            self._module(week, 2)
        with CaptureQueriesContext(connection) as after:
            self._stats()
        self.assertEqual(len(after), len(before))


class PasswordResetAdminTests(APITestCase):
    OLD_PASSWORD = "oldpass-123"

    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.student = User.objects.create_user(
            email="student@test.local", password=self.OLD_PASSWORD,
        )
        self.other = User.objects.create_user(email="other@test.local", password="testpass")
        _enroll(self.student, self.other)

    def _reset(self, user_id):
        return self.client.post(f"/api/users/{user_id}/reset-password/")

    def test_admin_reset_returns_a_temporary_password_that_logs_in(self):
        self.client.force_login(self.admin)
        resp = self._reset(self.student.pk)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        temp = resp.data["temporary_password"]
        self.assertEqual(len(temp), 12)

        self.client.logout()
        old = self.client.post(
            "/api/login/", {"email": "student@test.local", "password": self.OLD_PASSWORD}, format="json",
        )
        self.assertEqual(old.status_code, status.HTTP_401_UNAUTHORIZED)
        new = self.client.post(
            "/api/login/", {"email": "student@test.local", "password": temp}, format="json",
        )
        self.assertEqual(new.status_code, status.HTTP_200_OK)

    def test_reset_signs_the_student_out_everywhere(self):
        AuthToken.issue(self.student)
        self.client.force_login(self.admin)
        self.assertEqual(self._reset(self.student.pk).status_code, status.HTTP_200_OK)
        self.assertFalse(self.student.auth_tokens.exists())

    def test_each_reset_gives_a_different_password(self):
        self.client.force_login(self.admin)
        first = self._reset(self.student.pk).data["temporary_password"]
        second = self._reset(self.student.pk).data["temporary_password"]
        self.assertNotEqual(first, second)

    def test_students_cannot_reset_passwords(self):
        self.client.force_login(self.other)
        self.assertEqual(self._reset(self.student.pk).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self._reset(self.other.pk).status_code, status.HTTP_403_FORBIDDEN)
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password(self.OLD_PASSWORD))

    def test_anonymous_cannot_reset_passwords(self):
        resp = self._reset(self.student.pk)
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password(self.OLD_PASSWORD))

    def test_admin_passwords_cannot_be_reset(self):
        other_admin = User.objects.create_user(
            email="admin2@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.client.force_login(self.admin)
        self.assertEqual(self._reset(other_admin.pk).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self._reset(self.admin.pk).status_code, status.HTTP_403_FORBIDDEN)
        other_admin.refresh_from_db()
        self.assertTrue(other_admin.check_password("testpass"))

    def test_google_accounts_are_refused(self):
        google_user = User.objects.create_user(email="g@test.local", auth_provider="google")
        self.client.force_login(self.admin)
        resp = self._reset(google_user.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Google", str(resp.data))
        google_user.refresh_from_db()
        self.assertFalse(google_user.has_usable_password())

    def test_unknown_user_returns_404(self):
        self.client.force_login(self.admin)
        self.assertEqual(self._reset(999999).status_code, status.HTTP_404_NOT_FOUND)
