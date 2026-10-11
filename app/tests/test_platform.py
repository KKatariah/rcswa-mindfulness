"""Cross-cutting hardening: security rules, health check, pagination and media serving."""

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone
from rest_framework import status

from ..models import Cohort, Enrollment, ForumPost, ForumThread, Module, Survey
from .base import User, TestCase, APITestCase, _cohort


class SecurityHardeningTests(APITestCase):
    def setUp(self):
        today = timezone.localdate()
        self.cohort = Cohort.objects.create(
            name="C", year=today.year, start_date=today - timedelta(days=7), end_date=today + timedelta(days=49),
        )
        self.student = User.objects.create_user(
            email="s@test.local", password="testpass", full_name="Stu", forum_rules_accepted_at=timezone.now(),
        )
        Enrollment.objects.create(user=self.student, cohort=self.cohort)
        self.thread = ForumThread.objects.create(created_by=self.student, title="t")
        self.opening = ForumPost.objects.create(thread=self.thread, author=self.student, body="hi", is_head_post=True)

    def _user(self, email, status_value=None):
        user = User.objects.create_user(email=email, password="testpass")
        if status_value:
            Enrollment.objects.create(user=user, cohort=self.cohort, status=status_value)
        return user

    def test_forum_responses_never_include_emails(self):
        self.client.force_authenticate(self.student)
        listing = self.client.get("/api/forum/threads/").data["results"]
        detail = self.client.get(f"/api/forum/threads/{self.thread.pk}/").data
        self.assertNotIn("s@test.local", str(listing) + str(detail))
        self.assertNotIn("author_email", listing[0])
        self.assertNotIn("author_email", detail["opening_post"])

    def test_only_participants_submit_surveys(self):
        survey = Survey.objects.create(
            code="end", title="End", type="end", questions=[{"id": "q1", "type": "integer", "text": "x"}],
        )
        cases = [
            (self._user("pending@test.local", Enrollment.Status.PENDING), status.HTTP_403_FORBIDDEN),
            (self._user("withdrawn@test.local", Enrollment.Status.WITHDRAWN), status.HTTP_403_FORBIDDEN),
            (self._user("nobody@test.local"), status.HTTP_403_FORBIDDEN),
            # Only ACTIVE enrollments pass IsApproved, so completed students are locked out too.
            (self._user("done@test.local", Enrollment.Status.COMPLETED), status.HTTP_403_FORBIDDEN),
            (self.student, status.HTTP_201_CREATED),
        ]
        for user, expected in cases:
            self.client.force_authenticate(user)
            listing = self.client.get("/api/surveys/")
            if expected == status.HTTP_201_CREATED:
                listed = next(s for s in listing.data if s["id"] == survey.pk)
                self.assertTrue(listed["is_unlocked"], user.email)
            else:
                self.assertEqual(listing.status_code, status.HTTP_403_FORBIDDEN, user.email)
            resp = self.client.post("/api/survey-responses/", {"survey": survey.pk, "answers": {"q1": 1}}, format="json")
            self.assertEqual(resp.status_code, expected, user.email)

    def test_unpublished_or_locked_module_cannot_be_marked_viewed(self):
        with patch("app.signals._fire_async"):
            draft = Module.objects.create(week_number=9, title="Draft", is_published=False)
            locked = Module.objects.create(week_number=5, title="Locked", is_published=True)
            open_week = Module.objects.create(week_number=1, title="Open", is_published=True)
        self.client.force_authenticate(self.student)
        for module, expected in ((draft, 400), (locked, 400), (open_week, 201)):
            resp = self.client.post("/api/content-views/", {"module": module.pk}, format="json")
            self.assertEqual(resp.status_code, expected, module.title)

    def test_forum_posts_are_capped_at_5000_characters(self):
        self.client.force_authenticate(self.student)
        too_long = "x" * 5001
        self.assertEqual(self.client.post("/api/forum/threads/", {"body": too_long}, format="json").status_code, 400)
        self.assertEqual(
            self.client.post("/api/forum/posts/", {"thread": self.thread.pk, "body": too_long}, format="json").status_code, 400,
        )
        self.assertEqual(
            self.client.patch(f"/api/forum/posts/{self.opening.pk}/", {"body": too_long}, format="json").status_code, 400,
        )
        self.assertEqual(self.client.post("/api/forum/threads/", {"body": "x" * 5000}, format="json").status_code, 201)

    def test_reply_parent_must_be_in_the_same_thread(self):
        other = ForumThread.objects.create(created_by=self.student, title="o")
        self.client.force_authenticate(self.student)
        resp = self.client.post(
            "/api/forum/posts/", {"thread": other.pk, "body": "r", "parent_post": self.opening.pk}, format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("parent_post", resp.data)

    def test_cover_images_over_5mb_are_rejected(self):
        from io import BytesIO
        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image
        admin = User.objects.create_user(email="a@test.local", password="testpass", role=User.Role.ADMIN)
        self.client.force_authenticate(admin)
        small = BytesIO()
        Image.new("RGB", (10, 10)).save(small, "PNG")
        # A valid PNG padded past 5 MB (bytes after the end chunk are ignored by decoders).
        big = SimpleUploadedFile("big.png", small.getvalue() + b"\0" * (5 * 1024 * 1024), content_type="image/png")
        resp = self.client.post(
            "/api/additional-resources/", {"category": "book", "title": "Big", "cover_image": big}, format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("5 MB", str(resp.data["cover_image"]))
        ok = SimpleUploadedFile("ok.png", small.getvalue(), content_type="image/png")
        resp = self.client.post(
            "/api/additional-resources/", {"category": "book", "title": "Ok", "cover_image": ok}, format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)


class HealthCheckTests(APITestCase):
    def test_ok_without_logging_in(self):
        resp = self.client.get("/api/health/")
        self.assertEqual((resp.status_code, resp.data), (status.HTTP_200_OK, {"status": "ok"}))

    def test_503_when_database_unreachable(self):
        from django.db import OperationalError
        with patch("app.views.connection.ensure_connection", side_effect=OperationalError("down")), \
                self.assertLogs("app.views", level="ERROR"):
            resp = self.client.get("/api/health/")
        self.assertEqual(resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)


class PaginationTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@test.local", password="pw", full_name="Ada Admin", role=User.Role.ADMIN,
            forum_rules_accepted_at=timezone.now(),
        )
        self.client.force_authenticate(self.admin)

    def test_users_are_paged_newest_first(self):
        for i in range(30):
            User.objects.create_user(email=f"s{i}@test.local", password="pw")
        first = self.client.get("/api/users/").data
        self.assertEqual((first["count"], len(first["results"])), (31, 25))
        self.assertEqual(first["results"][0]["email"], "s29@test.local")
        rest = self.client.get("/api/users/?limit=25&offset=25").data["results"]
        self.assertEqual(len(rest), 6)
        self.assertEqual(rest[-1]["email"], "admin@test.local")
        self.assertEqual(len(self.client.get("/api/users/?limit=1000").data["results"]), 31)  # capped at 100

    def test_users_search_and_role_filter(self):
        User.objects.create_user(email="jo@test.local", password="pw", full_name="Jo Bloggs", display_name="Sunny")
        User.objects.create_user(email="sam@test.local", password="pw", full_name="Sam")

        def emails(params):
            return [u["email"] for u in self.client.get(f"/api/users/?{params}").data["results"]]

        self.assertEqual(emails("search=bloggs"), ["jo@test.local"])
        self.assertEqual(emails("search=SUNNY"), ["jo@test.local"])
        self.assertEqual(emails("search=sam@"), ["sam@test.local"])
        self.assertEqual(emails("role=admin"), ["admin@test.local"])

    def test_users_include_their_latest_enrollment_without_extra_queries(self):
        old, new = _cohort(100), _cohort(10)
        for i in range(5):
            user = User.objects.create_user(email=f"s{i}@test.local", password="pw")
            Enrollment.objects.create(user=user, cohort=old, status=Enrollment.Status.WITHDRAWN)
            Enrollment.objects.create(user=user, cohort=new, status=Enrollment.Status.ACTIVE)
        with self.assertNumQueries(3):  # count, page of users, their enrollments
            results = self.client.get("/api/users/").data["results"]
        by_email = {u["email"]: u for u in results}
        self.assertEqual(
            (by_email["s0@test.local"]["enrollment"]["cohort"], by_email["s0@test.local"]["enrollment"]["status"]),
            (new.pk, "active"),
        )
        self.assertIsNone(by_email["admin@test.local"]["enrollment"])

    def test_enrollments_are_paged(self):
        cohort = _cohort(10)
        for i in range(30):
            Enrollment.objects.create(user=User.objects.create_user(email=f"s{i}@test.local", password="pw"), cohort=cohort)
        data = self.client.get(f"/api/enrollments/?cohort={cohort.pk}&limit=1").data
        self.assertEqual((data["count"], len(data["results"])), (30, 1))

    def _thread(self, author, body):
        thread = ForumThread.objects.create(title=body[:20], created_by=author)
        ForumPost.objects.create(thread=thread, author=author, body=body, is_head_post=True)
        return thread

    def test_forum_threads_are_paged(self):
        for i in range(30):
            self._thread(self.admin, f"Thread {i}")
        data = self.client.get("/api/forum/threads/?limit=10&offset=20").data
        self.assertEqual((data["count"], len(data["results"])), (30, 10))

    def test_forum_search_matches_body_and_shown_author_name(self):
        student = User.objects.create_user(
            email="s@test.local", password="pw", full_name="Real Name", display_name="Moonbeam",
            forum_rules_accepted_at=timezone.now(),
        )
        self._thread(student, "Breathing helped me today")
        self._thread(self.admin, "Welcome everyone")

        def bodies(params):
            return [t["body"] for t in self.client.get(f"/api/forum/threads/?{params}").data["results"]]

        self.assertEqual(bodies("search=breathing"), ["Breathing helped me today"])
        self.assertEqual(bodies("search=moonbeam"), ["Breathing helped me today"])
        # Admins see "Moonbeam (Real Name)", so they can search by the real name too.
        self.assertEqual(bodies("search=real name"), ["Breathing helped me today"])

        Enrollment.objects.create(user=student, cohort=_cohort(10), status=Enrollment.Status.ACTIVE)
        self.client.force_authenticate(student)
        # Students only see the display name, so searching the real name must not find the thread.
        self.assertEqual(bodies("search=real name"), [])
        self.assertEqual(bodies("search=moonbeam"), ["Breathing helped me today"])
        self.assertEqual(bodies("search=ada admin"), ["Welcome everyone"])  # no display name: full name is shown


class MediaServingTests(TestCase):
    """Uploaded cover images are served whether or not DEBUG is on (tests run with DEBUG off)."""

    def test_uploaded_file_is_served_as_an_inert_image(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as media_root, self.settings(MEDIA_ROOT=media_root):
            (Path(media_root) / "resource_covers").mkdir()
            (Path(media_root) / "resource_covers" / "c.png").write_bytes(b"\x89PNG\r\n\x1a\n")
            resp = self.client.get("/media/resource_covers/c.png")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp["Content-Type"], "image/png")
            self.assertEqual(resp["Content-Security-Policy"], "default-src 'none'; sandbox")
            self.assertEqual(resp["X-Content-Type-Options"], "nosniff")
            self.assertEqual(self.client.get("/media/resource_covers/missing.png").status_code, 404)
            self.assertIn(self.client.get("/media/../server/settings.py").status_code, (400, 404))
