"""Modules, content items, completion and week unlocking."""

from datetime import date, timedelta
from unittest.mock import patch

from rest_framework import status

from ..models import Cohort, ContentCompletion, ContentItem, Enrollment, Module
from .base import User, TestCase, APITestCase, _enroll, _cohort


class ModuleListTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass"
        )
        self.cohort = Cohort.objects.create(
            name="Test Cohort", year=2024,
            start_date=date(2024, 1, 1), end_date=date(2024, 12, 31),
        )
        Enrollment.objects.create(
            user=self.student, cohort=self.cohort, status=Enrollment.Status.ACTIVE,
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


class ModuleSummaryPublicTests(APITestCase):
    def setUp(self):
        Module.objects.create(week_number=1, title="Week 1", is_published=True)

    def test_anonymous_summary_returns_200(self):
        resp = self.client.get("/api/modules/summary/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_anonymous_module_list_returns_401(self):
        resp = self.client.get("/api/modules/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


class EmbedUrlNormalizationTests(TestCase):
    def setUp(self):
        self.module = Module.objects.create(week_number=1, title="Week 1", is_published=True)

    def _make(self, embed_url, provider=ContentItem.Provider.YOUTUBE):
        return ContentItem.objects.create(
            module=self.module, title="Video", type=ContentItem.ContentType.VIDEO,
            provider=provider, embed_url=embed_url,
        )

    def test_watch_url_converted_to_embed(self):
        item = self._make("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertEqual(item.embed_url, "https://www.youtube.com/embed/dQw4w9WgXcQ")

    def test_watch_url_with_extra_query_params_converted(self):
        item = self._make("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&index=3")
        self.assertEqual(item.embed_url, "https://www.youtube.com/embed/dQw4w9WgXcQ")

    def test_short_url_converted_to_embed(self):
        item = self._make("https://youtu.be/dQw4w9WgXcQ?t=30")
        self.assertEqual(item.embed_url, "https://www.youtube.com/embed/dQw4w9WgXcQ")

    def test_shorts_url_converted_to_embed(self):
        item = self._make("https://www.youtube.com/shorts/dQw4w9WgXcQ")
        self.assertEqual(item.embed_url, "https://www.youtube.com/embed/dQw4w9WgXcQ")

    def test_mobile_url_converted_to_embed(self):
        item = self._make("https://m.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertEqual(item.embed_url, "https://www.youtube.com/embed/dQw4w9WgXcQ")

    def test_already_embed_url_left_equivalent(self):
        item = self._make("https://www.youtube.com/embed/dQw4w9WgXcQ")
        self.assertEqual(item.embed_url, "https://www.youtube.com/embed/dQw4w9WgXcQ")

    def test_youtube_url_on_soundcloud_item_left_unchanged(self):
        item = self._make(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ", provider=ContentItem.Provider.SOUNDCLOUD,
        )
        self.assertEqual(item.embed_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    def test_unrecognised_url_left_unchanged(self):
        item = self._make("https://example.com/video")
        self.assertEqual(item.embed_url, "https://example.com/video")

    def test_soundcloud_track_url_converted_to_embed(self):
        item = self._make(
            "https://soundcloud.com/artist/track", provider=ContentItem.Provider.SOUNDCLOUD,
        )
        self.assertEqual(
            item.embed_url,
            "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack",
        )

    def test_soundcloud_set_url_converted_to_embed(self):
        item = self._make(
            "https://soundcloud.com/artist/sets/playlist-name", provider=ContentItem.Provider.SOUNDCLOUD,
        )
        self.assertEqual(
            item.embed_url,
            "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Fsets%2Fplaylist-name",
        )

    def test_soundcloud_www_url_converted_to_embed(self):
        item = self._make(
            "https://www.soundcloud.com/artist/track", provider=ContentItem.Provider.SOUNDCLOUD,
        )
        self.assertEqual(
            item.embed_url,
            "https://w.soundcloud.com/player/?url=https%3A%2F%2Fwww.soundcloud.com%2Fartist%2Ftrack",
        )

    def test_soundcloud_already_embed_url_left_unchanged(self):
        embed = "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack"
        item = self._make(embed, provider=ContentItem.Provider.SOUNDCLOUD)
        self.assertEqual(item.embed_url, embed)


class ContentCompletionTests(APITestCase):
    def setUp(self):
        self.student1 = User.objects.create_user(
            email="s1@test.local", password="testpass"
        )
        self.student2 = User.objects.create_user(
            email="s2@test.local", password="testpass"
        )
        _enroll(self.student1, self.student2)
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


class ModuleUnlockTests(APITestCase):
    """Week N unlocks (N-1) weeks after the student's cohort start date."""

    def setUp(self):
        from django.utils import timezone
        self.today = timezone.localdate()
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass",
        )
        # Started a week ago: weeks 1-2 are open, week 3 opens in 7 days.
        self.cohort = Cohort.objects.create(
            name="Test Cohort", year=self.today.year,
            start_date=self.today - timedelta(days=7), end_date=self.today + timedelta(days=60),
        )
        Enrollment.objects.create(
            user=self.student, cohort=self.cohort, status=Enrollment.Status.ACTIVE,
        )
        self.week1 = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        self.week2 = Module.objects.create(week_number=2, title="Week 2", is_published=True)
        self.week3 = Module.objects.create(week_number=3, title="Week 3", is_published=True)
        self.week3_item = ContentItem.objects.create(
            module=self.week3, title="Video", type=ContentItem.ContentType.VIDEO,
            provider="youtube", embed_url="https://www.youtube.com/embed/ZToicYcHIOU",
        )

    def _modules_by_week(self):
        resp = self.client.get("/api/modules/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        return {m["week_number"]: m for m in resp.data}

    def test_weeks_unlock_from_cohort_start(self):
        self.client.force_login(self.student)
        modules = self._modules_by_week()
        self.assertTrue(modules[1]["is_unlocked"])
        self.assertTrue(modules[2]["is_unlocked"])
        self.assertFalse(modules[3]["is_unlocked"])
        self.assertEqual(modules[3]["unlock_at"], (self.today + timedelta(days=7)).isoformat())
        self.assertEqual(modules[3]["content_items"], [])

    def test_week_unlocks_on_its_start_day(self):
        self.cohort.start_date = self.today - timedelta(days=14)
        self.cohort.save()
        self.client.force_login(self.student)
        self.assertTrue(self._modules_by_week()[3]["is_unlocked"])

    def test_week0_intro_opens_with_week1(self):
        Module.objects.create(week_number=0, title="Module 0 - Introduction", is_published=True)
        self.client.force_login(self.student)
        modules = self._modules_by_week()
        self.assertTrue(modules[0]["is_unlocked"])
        self.assertEqual(modules[0]["unlock_at"], modules[1]["unlock_at"])
        self.assertEqual(list(modules)[0], 0)

    def test_locked_module_detail_returns_403(self):
        self.client.force_login(self.student)
        resp = self.client.get(f"/api/modules/{self.week3.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_complete_item_in_locked_module(self):
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/progress/", {"content_item": self.week3_item.pk}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(ContentCompletion.objects.filter(user=self.student).exists())

    def test_admin_can_open_locked_module_with_content(self):
        self.client.force_login(self.admin)
        resp = self.client.get(f"/api/modules/{self.week3.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data["content_items"]), 1)
        self.assertEqual(len(self._modules_by_week()[3]["content_items"]), 1)


class CohortStartDateTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="admin@test.local", password="testpass", role=User.Role.ADMIN)
        self.client.force_login(self.admin)

    def _move_start(self, cohort):
        return self.client.patch(
            f"/api/cohorts/{cohort.pk}/", {"start_date": str(cohort.start_date - timedelta(days=7))},
            content_type="application/json",
        )

    def test_running_cohort_with_students_keeps_start_date(self):
        cohort = _cohort(10)
        Enrollment.objects.create(user=User.objects.create_user(email="s@test.local"), cohort=cohort)
        self.assertEqual(self._move_start(cohort).status_code, status.HTTP_400_BAD_REQUEST)

    def test_future_or_empty_cohort_start_date_can_change(self):
        empty_running = _cohort(10)
        self.assertEqual(self._move_start(empty_running).status_code, status.HTTP_200_OK)
        future = _cohort(-14)
        Enrollment.objects.create(user=User.objects.create_user(email="s@test.local"), cohort=future)
        self.assertEqual(self._move_start(future).status_code, status.HTTP_200_OK)

    def test_renaming_running_cohort_still_allowed(self):
        cohort = _cohort(10)
        Enrollment.objects.create(user=User.objects.create_user(email="s@test.local"), cohort=cohort)
        resp = self.client.patch(f"/api/cohorts/{cohort.pk}/", {"name": "Renamed"}, content_type="application/json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


class ContentItemReorderValidationTests(APITestCase):
    def test_non_integer_ids_are_rejected(self):
        admin = User.objects.create_user(email="admin@test.local", password="testpass", role=User.Role.ADMIN)
        with patch("app.signals._fire_async"):
            module = Module.objects.create(week_number=1, title="W1")
            item = ContentItem.objects.create(
                module=module, title="V", type="video", provider="youtube", embed_url="https://www.youtube.com/embed/x",
            )
        self.client.force_login(admin)
        for ids in (["1"], [item.pk, "x"], "nope"):
            resp = self.client.post("/api/content-items/reorder/", {"module": module.pk, "ids": ids}, format="json")
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, ids)
        resp = self.client.post("/api/content-items/reorder/", {"module": module.pk, "ids": [item.pk]}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
