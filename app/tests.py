import datetime
from datetime import date, timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.cache import cache
from django.test import TestCase as DjangoTestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase
from rest_framework.authtoken.models import Token

from .models import (
    AdditionalResource,
    Cohort,
    ContentCompletion,
    ContentItem,
    Enrollment,
    ForumPost,
    ForumThread,
    Module,
    NotificationLog,
    NotificationPreference,
    PushSubscription,
    Survey,
    SurveyResponse,
)

from .serializers import ForumPostSerializer
from .utils import gravatar_url

User = get_user_model()


class _ClearCacheMixin:
    """Rate-limit counters live in the cache, which Django does not reset between tests."""

    def _pre_setup(self):
        super()._pre_setup()
        cache.clear()


class TestCase(_ClearCacheMixin, DjangoTestCase):
    pass


class APITestCase(_ClearCacheMixin, DRFAPITestCase):
    pass


def _enroll(*users):
    """Put users in an active cohort that started a year ago, so every module week is unlocked."""
    today = date.today()
    cohort = Cohort.objects.create(
        name="Enrolled Cohort", year=today.year,
        start_date=today - timedelta(days=365), end_date=today + timedelta(days=365),
    )
    for user in users:
        Enrollment.objects.create(user=user, cohort=cohort, status=Enrollment.Status.ACTIVE)


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


# ── Embed URL normalization ───────────────────────────────────────────────────────

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


class UserAvatarTests(APITestCase):
    def test_user_avatar_url_is_server_generated_from_email(self):
        user = User.objects.create_user(
            email="student@test.local",
            password="testpass",
        )

        self.client.force_login(user)

        resp = self.client.get("/api/user/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["user"]["avatar_url"], gravatar_url(user.email))
        self.assertNotIn("gravatar_url", resp.data["user"])

    def test_deleted_user_avatar_defaults_to_gravatar_mystery_person(self):
        thread = ForumThread.objects.create(
            title="Test thread",
            created_by=None,
        )
        post = ForumPost.objects.create(
            thread=thread,
            author=None,
            body="deleted author",
        )

        serializer = ForumPostSerializer(instance=post)
        self.assertEqual(serializer.data["author_avatar_url"], gravatar_url(""))


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


class ForumTests(APITestCase):
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
        self.thread = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Test Thread"
        )
        self.opening = ForumPost.objects.create(
            thread=self.thread,
            author=self.student,
            body="Opening body",
            is_head_post=True,
        )
        self.thread.opened_by = self.opening
        self.thread.save(update_fields=["opened_by"])
        self.reply = ForumPost.objects.create(
            thread=self.thread, author=self.other, body="A reply"
        )

    def test_post_creation_rate_limited_but_edits_are_not(self):
        self.client.force_login(self.other)
        for i in range(6):
            resp = self.client.post(
                "/api/forum/posts/", {"thread": self.thread.pk, "body": f"reply {i}"},
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        resp = self.client.post(
            "/api/forum/posts/", {"thread": self.thread.pk, "body": "one too many"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        resp = self.client.patch(
            f"/api/forum/posts/{self.reply.pk}/", {"body": "still editable"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    # ── S24/anonymous rejection ────────────────────────────────────────────────

    def test_anonymous_list_rejected(self):
        resp = self.client.get("/api/forum/threads/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_anonymous_post_rejected(self):
        resp = self.client.patch(
            f"/api/forum/posts/{self.opening.pk}/",
            {"body": "hacked"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    # ── S27: author edits / non-author refused ─────────────────────────────────

    def test_author_can_edit_own_post(self):
        self.client.force_login(self.student)
        resp = self.client.patch(
            f"/api/forum/posts/{self.opening.pk}/",
            {"body": "Updated body"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.opening.refresh_from_db()
        self.assertEqual(self.opening.body, "Updated body")

    def test_non_author_edit_refused(self):
        self.client.force_login(self.other)
        resp = self.client.patch(
            f"/api/forum/posts/{self.opening.pk}/",
            {"body": "hacked"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_author_can_delete_own_thread(self):
        self.client.force_login(self.student)
        resp = self.client.delete(f"/api/forum/threads/{self.thread.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

    def test_non_author_delete_refused(self):
        self.client.force_login(self.other)
        resp = self.client.delete(f"/api/forum/threads/{self.thread.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # ── S28: admin can edit anywhere ───────────────────────────────────────────

    def test_admin_can_edit_anyone_post(self):
        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/forum/posts/{self.opening.pk}/",
            {"body": "Admin edit"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.opening.refresh_from_db()
        self.assertEqual(self.opening.body, "Admin edit")

    # ── S24: reply count ───────────────────────────────────────────────────────

    def test_reply_count_correct_with_replies(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/forum/threads/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        thread_data = next(t for t in resp.data if t["id"] == self.thread.pk)
        # 2 posts total (opening + reply), reply_count = 1
        self.assertEqual(thread_data["reply_count"], 1)

    def test_reply_count_zero_for_new_thread(self):
        new_thread = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Solo thread"
        )
        ForumPost.objects.create(thread=new_thread, author=self.student, body="Just me")
        self.client.force_login(self.student)
        resp = self.client.get("/api/forum/threads/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        thread_data = next(t for t in resp.data if t["id"] == new_thread.pk)
        self.assertEqual(thread_data["reply_count"], 0)

    # ── S26: replies nested under thread detail ────────────────────────────────

    def test_replies_nested_oldest_first(self):
        self.client.force_login(self.student)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        replies = resp.data["replies"]
        # Only the reply appears (opening post is excluded)
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["body"], "A reply")

    # ── S25: create thread ─────────────────────────────────────────────────────

    def test_student_can_create_thread(self):
        """Title is derived from body; no module required."""
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/forum/threads/",
            {"body": "Hello world, what a great day"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        # Title is derived from body (≤60 chars → returned verbatim)
        self.assertEqual(resp.data["title"], "Hello world, what a great day")
        self.assertEqual(resp.data["body"], "Hello world, what a great day")
        self.assertEqual(resp.data["reply_count"], 0)
        self.assertIsNone(resp.data["module"])
        self.assertIsNone(resp.data["content_item"])
        thread = ForumThread.objects.get(pk=resp.data["id"])
        self.assertIsNotNone(thread.opened_by)
        self.assertTrue(thread.opened_by.is_head_post)
        self.assertEqual(thread.opened_by.thread_id, thread.pk)

    # ── Fix 1: at-most-one constraint ─────────────────────────────────────────

    def test_thread_without_context_saves_successfully(self):
        """Both module and content_item null is now valid."""
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/forum/threads/",
            {"body": "General discussion, no module attached"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(resp.data["module"])
        self.assertIsNone(resp.data["content_item"])

    def test_thread_with_both_contexts_rejected(self):
        """Both module and content_item set must be rejected (serializer + DB constraint)."""
        content_item = ContentItem.objects.create(
            module=self.module,
            title="Item",
            type="video",
            provider="youtube",
            embed_url="https://www.youtube.com/embed/x",
        )
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/forum/threads/",
            {
                "body": "Both set",
                "module": self.module.pk,
                "content_item": content_item.pk,
            },
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # ── Fix 3: soft delete ─────────────────────────────────────────────────────

    def test_deleted_reply_excluded_from_detail_and_count(self):
        """Soft-deleting a reply removes it from replies and decrements reply_count."""
        # self.reply is authored by self.other
        self.client.force_login(self.other)
        del_resp = self.client.delete(f"/api/forum/posts/{self.reply.pk}/")
        self.assertEqual(del_resp.status_code, status.HTTP_204_NO_CONTENT)

        # Reply row is still in DB (soft delete)
        self.reply.refresh_from_db()
        self.assertTrue(self.reply.is_deleted)

        self.client.force_login(self.student)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        reply_ids = [r["id"] for r in resp.data["replies"]]
        self.assertNotIn(self.reply.pk, reply_ids)
        self.assertEqual(resp.data["reply_count"], 0)

    def test_delete_opening_post_returns_400(self):
        """Attempting to delete the opening post must return 400."""
        self.client.force_login(self.student)
        resp = self.client.delete(f"/api/forum/posts/{self.opening.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        # Row must not be soft-deleted
        self.opening.refresh_from_db()
        self.assertFalse(self.opening.is_deleted)

    # ── Fix 4: null-safe author names ─────────────────────────────────────────

    def test_null_post_author_renders_as_deleted_user(self):
        """A post whose author FK is NULL renders author_name as 'Deleted user'."""
        self.reply.author = None
        self.reply.save()
        data = ForumPostSerializer(self.reply, context={"request": None}).data
        self.assertEqual(data["author_name"], "Deleted user")

    def test_null_thread_author_renders_as_deleted_user(self):
        """A thread whose created_by FK is NULL renders author_name as 'Deleted user'."""
        self.thread.created_by = None
        self.thread.save()
        self.client.force_login(self.student)
        resp = self.client.get("/api/forum/threads/")
        thread_data = next(t for t in resp.data if t["id"] == self.thread.pk)
        self.assertEqual(thread_data["author_name"], "Deleted user")

    # ── Fix 5: title derived from body ────────────────────────────────────────

    def test_title_derived_from_short_body(self):
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/forum/threads/",
            {"body": "Short body"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["title"], "Short body")

    def test_title_trimmed_at_word_boundary_for_long_body(self):
        long_body = "This is a very long opening post that clearly exceeds the sixty character limit set for titles"
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/forum/threads/",
            {"body": long_body},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        title = resp.data["title"]
        self.assertLessEqual(len(title), 60)
        # Must end at a word boundary (no mid-word cut)
        self.assertFalse(title[-1] == " ")
        self.assertTrue(long_body.startswith(title))

    # ── can_edit flag reflects authorship ─────────────────────────────────────

    def test_can_edit_true_for_author(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/forum/threads/")
        thread_data = next(t for t in resp.data if t["id"] == self.thread.pk)
        self.assertTrue(thread_data["can_edit"])

    def test_can_edit_false_for_non_author(self):
        self.client.force_login(self.other)
        resp = self.client.get("/api/forum/threads/")
        thread_data = next(t for t in resp.data if t["id"] == self.thread.pk)
        self.assertFalse(thread_data["can_edit"])

    def test_admin_can_edit_all_content(self):
        """Admin sees can_edit=True on threads and replies they didn't author."""
        self.client.force_login(self.admin)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Thread created by student — admin can still edit
        self.assertTrue(resp.data["can_edit"])
        # Reply written by other — admin can still edit
        self.assertTrue(resp.data["replies"][0]["can_edit"])

    # ── Check 1: _derive_title no-space fallback ───────────────────────────────

    def test_title_capped_at_60_chars_for_no_space_body(self):
        """A 300-char body with no whitespace produces a title of at most 60 chars."""
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/forum/threads/",
            {"body": "x" * 300},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertLessEqual(len(resp.data["title"]), 60)

    # ── Check 2: title resynced when opening post is edited ────────────────────

    def test_editing_opening_post_resyncs_thread_title(self):
        """Patching the opening post body recomputes and stores the thread title."""
        new_body = "Updated opening body with new content"  # ≤60 chars → title == body
        self.client.force_login(self.student)
        self.client.patch(
            f"/api/forum/posts/{self.opening.pk}/",
            {"body": new_body},
            content_type="application/json",
        )
        self.thread.refresh_from_db()
        self.assertEqual(self.thread.title, new_body)

    def test_editing_non_opening_post_does_not_change_thread_title(self):
        """Patching a reply must not affect the thread title."""
        original_title = self.thread.title
        self.client.force_login(self.other)
        self.client.patch(
            f"/api/forum/posts/{self.reply.pk}/",
            {"body": "Totally different content that should not become the title"},
            content_type="application/json",
        )
        self.thread.refresh_from_db()
        self.assertEqual(self.thread.title, original_title)

    # ── Check 3: soft-deleted post is excluded from viewset queryset ───────────

    def test_patching_soft_deleted_post_returns_404(self):
        """A soft-deleted post must not be patchable — it should 404."""
        self.reply.is_deleted = True
        self.reply.save()
        self.client.force_login(self.other)
        resp = self.client.patch(
            f"/api/forum/posts/{self.reply.pk}/",
            {"body": "zombie patch"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    # ── Pin / unpin ────────────────────────────────────────────────────────────

    def test_admin_can_pin_thread(self):
        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/forum/threads/{self.thread.pk}/",
            {"is_pinned": True},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.thread.refresh_from_db()
        self.assertTrue(self.thread.is_pinned)

    def test_admin_can_unpin_thread(self):
        self.thread.is_pinned = True
        self.thread.save(update_fields=["is_pinned"])
        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/forum/threads/{self.thread.pk}/",
            {"is_pinned": False},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.thread.refresh_from_db()
        self.assertFalse(self.thread.is_pinned)
        self.assertEqual(self.thread.pin_order, 0)

    def test_unpin_then_repin_succeeds_at_pin_limit(self):
        pinned_threads = []
        for order in range(1, 6):
            thread = ForumThread.objects.create(
                module=self.module,
                created_by=self.student,
                title=f"Pinned {order}",
                is_pinned=True,
                pin_order=order,
            )
            head_post = ForumPost.objects.create(
                thread=thread,
                author=self.student,
                body=f"Pinned body {order}",
                is_head_post=True,
            )
            thread.opened_by = head_post
            thread.save(update_fields=["opened_by"])
            pinned_threads.append(thread)

        replacement = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Replacement"
        )
        replacement_head = ForumPost.objects.create(
            thread=replacement,
            author=self.student,
            body="Replacement body",
            is_head_post=True,
        )
        replacement.opened_by = replacement_head
        replacement.save(update_fields=["opened_by"])

        self.client.force_login(self.admin)
        unpin_response = self.client.patch(
            f"/api/forum/threads/{pinned_threads[-1].pk}/",
            {"is_pinned": False},
            content_type="application/json",
        )
        self.assertEqual(unpin_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            list(
                ForumThread.objects.filter(is_pinned=True)
                .order_by("pin_order")
                .values_list("pin_order", flat=True)
            ),
            [1, 2, 3, 4],
        )

        pin_response = self.client.patch(
            f"/api/forum/threads/{replacement.pk}/",
            {"is_pinned": True},
            content_type="application/json",
        )
        self.assertEqual(pin_response.status_code, status.HTTP_200_OK)
        self.assertEqual(ForumThread.objects.filter(is_pinned=True).count(), 5)
        self.assertEqual(
            list(
                ForumThread.objects.filter(is_pinned=True)
                .order_by("pin_order")
                .values_list("pin_order", flat=True)
            ),
            [1, 2, 3, 4, 5],
        )
        replacement.refresh_from_db()
        self.assertEqual(replacement.pin_order, 1)

    def test_student_pin_returns_403(self):
        self.client.force_login(self.student)
        resp = self.client.patch(
            f"/api/forum/threads/{self.thread.pk}/",
            {"is_pinned": True},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_pinned_thread_sorts_before_newer_unpinned(self):
        from django.utils import timezone
        from datetime import timedelta
        newer = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Newer unpinned"
        )
        ForumPost.objects.create(thread=newer, author=self.student, body="Newer body")
        # Push newer's updated_at ahead so it would sort first without pinning
        ForumThread.objects.filter(pk=newer.pk).update(
            updated_at=timezone.now() + timedelta(seconds=10)
        )
        self.thread.is_pinned = True
        self.thread.save(update_fields=["is_pinned"])
        self.client.force_login(self.student)
        resp = self.client.get("/api/forum/threads/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [t["id"] for t in resp.data]
        self.assertEqual(ids[0], self.thread.pk)

    def test_is_pinned_in_list_response(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/forum/threads/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        thread_data = next(t for t in resp.data if t["id"] == self.thread.pk)
        self.assertIn("is_pinned", thread_data)
        self.assertFalse(thread_data["is_pinned"])

    @override_settings(FORUM_MAX_PINNED_THREADS=3)
    def test_admin_pin_order_choices_use_configured_limit_without_zero(self):
        from .admin import ForumThreadAdminForm

        for order in (1, 2):
            ForumThread.objects.create(
                module=self.module,
                created_by=self.student,
                title=f"Existing pinned {order}",
                is_pinned=True,
                pin_order=order,
            )
        form = ForumThreadAdminForm(instance=self.thread)
        choices = [value for value, _label in form.fields["pin_order"].choices]
        self.assertEqual(choices, ["", 1, 2, 3])

    def test_admin_pin_order_change_shifts_other_pinned_threads(self):
        from django.contrib import admin
        from .admin import ForumThreadAdmin

        first_pinned = ForumThread.objects.create(
            module=self.module,
            created_by=self.student,
            title="Current first",
            is_pinned=True,
            pin_order=1,
        )
        thread_admin = ForumThreadAdmin(ForumThread, admin.site)

        self.thread.is_pinned = True
        self.thread.pin_order = 1
        thread_admin.save_model(None, self.thread, form=None, change=True)

        self.thread.refresh_from_db()
        first_pinned.refresh_from_db()
        self.assertEqual(self.thread.pin_order, 1)
        self.assertEqual(first_pinned.pin_order, 2)

    def _forum_thread_admin_form_data(self, is_pinned, pin_order):
        return {
            "title": self.thread.title,
            "module": self.module.pk,
            "content_item": "",
            "created_by": self.student.pk,
            "opened_by": self.opening.pk,
            "is_pinned": is_pinned,
            "pin_order": pin_order,
        }

    def test_admin_unpinned_thread_accepts_zero_pin_order(self):
        from .admin import ForumThreadAdminForm

        form = ForumThreadAdminForm(
            data=self._forum_thread_admin_form_data(is_pinned=False, pin_order=""),
            instance=self.thread,
        )
        self.assertTrue(form.is_valid(), form.errors)
        self.assertFalse(form.cleaned_data["is_pinned"])
        self.assertEqual(form.cleaned_data["pin_order"], 0)

    def test_admin_rejects_pin_order_without_is_pinned(self):
        from .admin import ForumThreadAdminForm

        form = ForumThreadAdminForm(
            data=self._forum_thread_admin_form_data(is_pinned=False, pin_order=1),
            instance=self.thread,
        )
        self.assertFalse(form.is_valid())
        self.assertIn(
            "You must select is_pinned to select a pin_order value.",
            form.errors["pin_order"],
        )

    @override_settings(FORUM_MAX_PINNED_THREADS=1)
    def test_admin_reports_max_limit_with_invalid_pin_order(self):
        from .admin import ForumThreadAdminForm

        ForumThread.objects.create(
            module=self.module,
            created_by=self.student,
            title="Pinned at capacity",
            is_pinned=True,
            pin_order=1,
        )
        form = ForumThreadAdminForm(
            data=self._forum_thread_admin_form_data(is_pinned=True, pin_order=2),
            instance=self.thread,
        )
        self.assertFalse(form.is_valid())
        self.assertIn("is_pinned", form.errors)
        self.assertIn("pin_order", form.errors)
        self.assertIn(
            "You have already reached the maximum of 1 pinned threads.",
            form.errors["is_pinned"],
        )

    def test_admin_parent_post_choices_include_only_head_posts(self):
        from django.contrib import admin
        from .admin import ForumPostAdmin

        post_admin = ForumPostAdmin(ForumPost, admin.site)
        parent_field = ForumPost._meta.get_field("parent_post")
        form_field = post_admin.formfield_for_foreignkey(parent_field, request=None)
        parent_ids = set(form_field.queryset.values_list("pk", flat=True))
        self.assertIn(self.opening.pk, parent_ids)
        self.assertNotIn(self.reply.pk, parent_ids)

    @override_settings(FORUM_MAX_PINNED_THREADS=2)
    def test_pin_order_is_used_for_pinned_threads(self):
        first = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="First pinned"
        )
        second = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Second pinned"
        )
        ForumPost.objects.create(thread=first, author=self.student, body="first")
        ForumPost.objects.create(thread=second, author=self.student, body="second")

        first.is_pinned = True
        first.pin_order = 2
        first.save(update_fields=["is_pinned", "pin_order"])

        second.is_pinned = True
        second.pin_order = 1
        second.save(update_fields=["is_pinned", "pin_order"])

        self.client.force_login(self.admin)
        resp = self.client.get("/api/forum/threads/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [t["id"] for t in resp.data if t["is_pinned"]]
        self.assertEqual(ids, [second.pk, first.pk])

    @override_settings(FORUM_MAX_PINNED_THREADS=2)
    def test_cannot_pin_more_than_max_threads(self):
        first = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Pinned 1"
        )
        second = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Pinned 2"
        )
        ForumPost.objects.create(thread=first, author=self.student, body="one")
        ForumPost.objects.create(thread=second, author=self.student, body="two")

        first.is_pinned = True
        first.pin_order = 1
        first.save(update_fields=["is_pinned", "pin_order"])

        second.is_pinned = True
        second.pin_order = 2
        second.save(update_fields=["is_pinned", "pin_order"])

        third = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Pinned 3"
        )
        ForumPost.objects.create(thread=third, author=self.student, body="three")

        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/forum/threads/{third.pk}/",
            {"is_pinned": True},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("You have already reached the maximum of 2 pinned threads.", str(resp.data))

    def test_editing_post_sets_edited_at(self):
        self.client.force_login(self.other)
        resp = self.client.patch(
            f"/api/forum/posts/{self.reply.pk}/",
            {"body": "Updated reply body"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.reply.refresh_from_db()
        self.assertIsNotNone(self.reply.edited_at)

    # ── updated_at bypass ──────────────────────────────────────────────────────

    def test_editing_opening_post_does_not_bump_thread_updated_at(self):
        """QuerySet.update() in perform_update bypasses auto_now — thread
        updated_at must be identical before and after an opening-post edit."""
        self.thread.refresh_from_db()
        updated_at_before = self.thread.updated_at

        self.client.force_login(self.student)
        resp = self.client.patch(
            f"/api/forum/posts/{self.opening.pk}/",
            {"body": "Fresh body that would change the derived title too"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.thread.refresh_from_db()
        self.assertEqual(
            self.thread.updated_at,
            updated_at_before,
            "editing the opening post must not bump thread.updated_at "
            "(QuerySet.update bypasses auto_now)",
        )


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


# ── Admin portal: role in auth responses ─────────────────────────────────────────

class AuthRoleTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass", full_name="Student One",
        )

    def test_login_response_includes_role(self):
        resp = self.client.post(
            "/api/login/",
            {"email": "student@test.local", "password": "testpass"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["user"]["role"], "student")

    def test_register_response_includes_role(self):
        resp = self.client.post(
            "/api/register/",
            {"email": "new@test.local", "full_name": "New User", "password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["user"]["role"], "student")

    def test_register_rejects_weak_passwords(self):
        for password in ["a", "password1", "12345678", "newuser123"]:
            resp = self.client.post(
                "/api/register/",
                {"email": "newuser@test.local", "full_name": "New User", "password": password},
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, password)
            self.assertIn("password", resp.data)
        self.assertFalse(User.objects.filter(email="newuser@test.local").exists())

    def test_change_password_rejects_weak_password(self):
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/change-password/",
            {"current_password": "testpass", "new_password": "password1"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("new_password", resp.data)

    def test_login_rate_limited_after_10_attempts(self):
        for _ in range(10):
            resp = self.client.post(
                "/api/login/",
                {"email": "student@test.local", "password": "wrong"},
                content_type="application/json",
            )
            self.assertNotEqual(resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        resp = self.client.post(
            "/api/login/",
            {"email": "student@test.local", "password": "testpass"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_current_user_returns_role(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/user/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["user"]["role"], "student")


# ── Admin portal: Cohort CRUD permissions ────────────────────────────────────────

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


# ── Admin portal: user management ────────────────────────────────────────────────

class UserManagementAdminTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(email="student@test.local", password="testpass")
        self.other = User.objects.create_user(email="other@test.local", password="testpass")
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )

    def test_student_lists_only_themselves(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/users/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([u["id"] for u in resp.data], [self.student.pk])
        self.assertNotIn("role", resp.data[0])

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
        by_email = {u["email"]: u for u in resp.data}
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


# ── Admin portal: sign-up approvals (enrollments) ────────────────────────────────

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
        self.assertEqual(self.client.get("/api/modules/").data, [])

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

        pending = self.client.get("/api/enrollments/?status=pending").data
        self.assertEqual([e["user_email"] for e in pending], ["student@test.local"])
        in_cohort = self.client.get(f"/api/enrollments/?cohort={self.cohort.pk}").data
        self.assertEqual(len(in_cohort), 2)

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


# ── Admin portal: additional resources ───────────────────────────────────────────

class AdditionalResourceAdminTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(email="student@test.local", password="testpass")
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )

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


# ── Admin portal: Module/ContentItem CRUD permissions ────────────────────────────

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


# ── Admin portal: module unlock computation ──────────────────────────────────────

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


# ── Admin portal: forum archive gating ───────────────────────────────────────────

class ForumArchiveTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass",
        )
        self.module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        self.thread = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Existing Thread",
        )
        ForumPost.objects.create(thread=self.thread, author=self.student, body="Opening")

    def _make_ended_cohort(self):
        return Cohort.objects.create(
            name="Ended Cohort", year=2025,
            start_date=date.today() - timedelta(days=100),
            end_date=date.today() - timedelta(days=1),
        )

    def test_thread_create_rejected_when_no_active_cohort(self):
        self._make_ended_cohort()
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/forum/threads/", {"body": "New thread"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_thread_create_allowed_when_cohort_active(self):
        Cohort.objects.create(
            name="Active Cohort", year=2026,
            start_date=date.today() - timedelta(days=7),
            end_date=date.today() + timedelta(days=49),
        )
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/forum/threads/", {"body": "New thread"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_post_create_rejected_when_program_inactive(self):
        self._make_ended_cohort()
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/forum/posts/",
            {"thread": self.thread.pk, "body": "A reply"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_forum_reads_always_allowed_when_program_inactive(self):
        self._make_ended_cohort()
        self.client.force_login(self.student)
        list_resp = self.client.get("/api/forum/threads/")
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        detail_resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertEqual(detail_resp.status_code, status.HTTP_200_OK)

    def test_program_status_endpoint_reflects_active_cohort(self):
        self.client.force_login(self.student)
        self.assertTrue(self.client.get("/api/program-status/").data["is_active"])

        self._make_ended_cohort()
        self.assertFalse(self.client.get("/api/program-status/").data["is_active"])


# ── Admin portal: dashboard stats ────────────────────────────────────────────────

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


# ── Notification tests (Issue #74) ─────────────────────────────────────────────

def _make_user(email, password="pw"):
    return User.objects.create_user(email=email, password=password)


def _make_cohort(name="C1", days_ago=7, duration=56):
    today = datetime.date.today()
    start = today - datetime.timedelta(days=days_ago)
    return Cohort.objects.create(
        name=name, year=today.year, start_date=start, end_date=start + datetime.timedelta(days=duration)
    )


def _make_module(week=1, published=True):
    return Module.objects.create(week_number=week, title=f"Week {week}", is_published=published)


def _make_audio_item(module, day_offset=0, title="Meditation"):
    return ContentItem.objects.create(
        module=module, title=title, type="audio", provider="soundcloud",
        embed_url="https://soundcloud.com/x/y", display_order=1, day_offset=day_offset,
    )


def _perth_midnight_utc(date):
    """Reproduce the command's formula so tests don't import from the command."""
    from zoneinfo import ZoneInfo
    from datetime import timezone as stdlib_tz
    PERTH_TZ = ZoneInfo("Australia/Perth")
    return datetime.datetime.combine(date, datetime.time.min, tzinfo=PERTH_TZ).astimezone(stdlib_tz.utc)


class PushSubscriptionEndpointReuseTests(APITestCase):
    """T1: registering the same push endpoint under a different user reassigns it."""

    def setUp(self):
        self.user_a = _make_user("a@test.local")
        self.user_b = _make_user("b@test.local")
        Token.objects.get_or_create(user=self.user_a)
        Token.objects.get_or_create(user=self.user_b)

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


class PushDeniedNoEmailFallbackTests(TestCase):
    """T2: push_denied=True skips both push and email."""

    def test_deliver_skips_when_push_denied(self):
        user = _make_user("denied@test.local")
        NotificationPreference.objects.create(user=user, push_denied=True, email_enabled=True)

        with patch("app.notifications.send_mail") as mock_mail:
            from app.notifications import deliver
            channel, success = deliver(
                user=user,
                payload_dict={"title": "test"},
                subject="Test",
                email_template="app/reminder_email.txt",
                email_context={"user": user, "item": None, "module": None},
            )

        self.assertFalse(success)
        self.assertIsNone(channel)
        mock_mail.assert_not_called()


class FailedSendRetriesNextRunTests(TestCase):
    """T3: a FAILED NotificationLog entry does not block the next run."""

    def setUp(self):
        self.user = _make_user("retry@test.local")
        # reminder_time defaults to 08:00 Perth — the mock will set current hour to 8
        self.cohort = _make_cohort(days_ago=0, duration=56)
        Enrollment.objects.create(user=self.user, cohort=self.cohort)
        self.module = _make_module(week=1)
        self.item = _make_audio_item(self.module, day_offset=0)

        today = datetime.date.today()
        scheduled_for = _perth_midnight_utc(today)

        NotificationLog.objects.create(
            user=self.user,
            type=NotificationLog.NotificationType.CONTENT_REMINDER,
            content_item=self.item,
            module=self.module,
            channel=NotificationLog.Channel.EMAIL,
            scheduled_for=scheduled_for,
            status=NotificationLog.Status.FAILED,
        )

    def test_failed_log_does_not_prevent_retry(self):
        from zoneinfo import ZoneInfo
        PERTH_TZ = ZoneInfo("Australia/Perth")
        fake_now = datetime.datetime.combine(
            datetime.date.today(), datetime.time(8, 0), tzinfo=PERTH_TZ
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


class VerifyMissingOffsetTests(TestCase):
    """T5: --verify exits non-zero when audio items have no day_offset."""

    def setUp(self):
        self.user = _make_user("verify@test.local")
        cohort = _make_cohort(days_ago=7, duration=56)
        Enrollment.objects.create(user=self.user, cohort=cohort, status=Enrollment.Status.ACTIVE)
        module = _make_module(week=1)
        # Audio item with no day_offset (unscheduled).
        ContentItem.objects.create(
            module=module, title="Unscheduled Audio", type="audio",
            provider="soundcloud", embed_url="https://soundcloud.com/x/y",
            display_order=1, day_offset=None,
        )

    def test_verify_exits_nonzero_for_unscheduled_audio(self):
        with self.assertRaises(SystemExit) as ctx:
            call_command("send_due_reminders", "--verify", stderr=StringIO(), stdout=StringIO())
        self.assertNotEqual(ctx.exception.code, 0)


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
        # Suppress SMTP; console backend is fine since we just check the log rows.
        with self.settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
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
        with self.settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
            from app.notifications import notify_content_update
            notify_content_update(module=locked_module)

        self.assertFalse(
            NotificationLog.objects.filter(
                type=NotificationLog.NotificationType.CONTENT_UPDATE,
                user=self.active_user,
            ).exists()
        )


# ── Edge cases ───────────────────────────────────────────────────────────────────

def _cohort(days_since_start, length_days=60):
    from django.utils import timezone
    today = timezone.localdate()
    return Cohort.objects.create(
        name=f"Cohort {days_since_start}", year=today.year,
        start_date=today - timedelta(days=days_since_start),
        end_date=today - timedelta(days=days_since_start) + timedelta(days=length_days),
    )


@override_settings(GOOGLE_CLIENT_ID="test-client")
class GoogleLoginEdgeCaseTests(APITestCase):
    def setUp(self):
        self.existing = User.objects.create_user(email="victim@test.local", password="testpass")

    def _google_login(self, idinfo):
        with patch("app.views.id_token.verify_oauth2_token", return_value=idinfo):
            return self.client.post("/api/google-login/", {"credential": "x"}, content_type="application/json")

    def test_unverified_email_cannot_log_into_existing_account(self):
        resp = self._google_login({"email": "victim@test.local", "email_verified": False, "name": "Attacker"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotIn("token", resp.data)

    def test_verified_email_logs_into_existing_account_ignoring_case(self):
        resp = self._google_login({"email": "Victim@Test.local", "email_verified": True, "name": "Victim"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["user"]["id"], self.existing.pk)
        self.assertEqual(User.objects.filter(email__iexact="victim@test.local").count(), 1)

    def test_new_google_user_is_created_lowercase_without_password(self):
        resp = self._google_login({"email": "New.Person@Gmail.com", "email_verified": True, "name": "New"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        user = User.objects.get(email="new.person@gmail.com")
        self.assertFalse(user.has_usable_password())
        self.client.force_login(user)
        resp = self.client.post(
            "/api/change-password/", {"current_password": "x", "new_password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Google", resp.data["error"])


class EmailCaseTests(APITestCase):
    def test_register_rejects_same_email_with_different_case(self):
        User.objects.create_user(email="student@test.local", password="testpass")
        resp = self.client.post(
            "/api/register/", {"email": "Student@Test.local", "full_name": "Dup", "password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", resp.data)

    def test_register_stores_lowercase_and_login_ignores_case(self):
        resp = self.client.post(
            "/api/register/", {"email": "Mixed.Case@Test.local", "full_name": "Mixed", "password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(email="mixed.case@test.local").exists())
        resp = self.client.post(
            "/api/login/", {"email": "MIXED.case@test.LOCAL", "password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


class LastAdminTests(APITestCase):
    def setUp(self):
        self.a = User.objects.create_user(email="a@test.local", password="testpass", role=User.Role.ADMIN)
        self.b = User.objects.create_user(email="b@test.local", password="testpass", role=User.Role.ADMIN)
        self.staff = User.objects.create_user(email="staff@test.local", password="testpass", is_staff=True)

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


class SurveyResponseProtectionTests(TestCase):
    def test_survey_with_responses_cannot_be_deleted(self):
        from django.db.models import ProtectedError
        user = User.objects.create_user(email="s@test.local", password="testpass")
        survey = Survey.objects.create(code="intake", title="Intake", type=Survey.SurveyType.INTAKE)
        SurveyResponse.objects.create(user=user, survey=survey, answers={"q1": 1})
        with self.assertRaises(ProtectedError):
            survey.delete()
        self.assertEqual(SurveyResponse.objects.count(), 1)


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
        with self.settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
            from app.notifications import notify_content_update
            notify_content_update(module=module)
        self.assertEqual(
            NotificationLog.objects.filter(user=self.student, type=NotificationLog.NotificationType.CONTENT_UPDATE).count(), 1,
        )


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


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
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
        from .serializers import module_is_unlocked
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


class ForumEdgeCaseTests(APITestCase):
    def test_pinned_thread_survives_author_deletion(self):
        admin = User.objects.create_user(email="admin@test.local", password="testpass", role=User.Role.ADMIN)
        author = User.objects.create_user(email="author@test.local", password="testpass")
        reader = User.objects.create_user(email="reader@test.local", password="testpass")
        self.client.force_login(author)
        tid = self.client.post("/api/forum/threads/", {"body": "Pinned by admin"}, format="json").data["id"]
        self.client.force_login(admin)
        self.client.patch(f"/api/forum/threads/{tid}/", {"is_pinned": True}, format="json")
        self.client.delete(f"/api/users/{author.pk}/")

        self.client.force_login(reader)
        listing = self.client.get("/api/forum/threads/")
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertTrue(listing.data[0]["is_pinned"])
        detail = self.client.get(f"/api/forum/threads/{tid}/")
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data["body"], "Pinned by admin")

    def test_title_cut_never_splits_an_emoji(self):
        from .views import _derive_title
        family = "\U0001F468‍\U0001F469‍\U0001F467"
        thumbs = "\U0001F44D\U0001F3FD"
        for filler in range(55, 62):
            for emoji in (family, thumbs):
                title = _derive_title("a" * filler + emoji * 3)
                self.assertFalse(title.endswith("‍"), (filler, title))
                self.assertLessEqual(len(title), 60)
                rest = ("a" * filler + emoji * 3)[len(title):]
                self.assertFalse(rest and rest[0] in ("‍", "\U0001F3FD"), (filler, title))


@override_settings(VAPID_PRIVATE_KEY="test-key", EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class PushFallbackTests(TestCase):
    def test_expired_subscription_is_removed_and_email_sent(self):
        from django.core import mail
        from pywebpush import WebPushException
        from .notifications import deliver
        user = User.objects.create_user(email="s@test.local", password="testpass")
        PushSubscription.objects.create(user=user, endpoint="https://push.example/gone", p256dh="k", auth="a")
        gone = WebPushException("gone", response=type("R", (), {"status_code": 410})())
        with patch("pywebpush.webpush", side_effect=gone):
            channel, success = deliver(
                user=user, payload_dict={"title": "t"}, subject="Hello",
                email_template="app/content_update_email.txt",
                email_context={"user": user, "module": type("M", (), {"title": "W1", "week_number": 1})()},
            )
        self.assertTrue(success)
        self.assertFalse(PushSubscription.objects.filter(user=user).exists())
        self.assertEqual([m.subject for m in mail.outbox], ["Hello"])


class ReminderTimeTests(APITestCase):
    def test_reminder_time_must_be_on_the_hour(self):
        user = User.objects.create_user(email="s@test.local", password="testpass")
        self.client.force_login(user)
        bad = self.client.patch("/api/notifications/preferences/me/", {"reminder_time": "08:30"}, format="json")
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        ok = self.client.patch("/api/notifications/preferences/me/", {"reminder_time": "19:00"}, format="json")
        self.assertEqual(ok.status_code, status.HTTP_200_OK)
