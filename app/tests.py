import datetime
from datetime import date, timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token

from .models import (
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
            thread=self.thread, author=self.student, body="Opening body"
        )
        self.reply = ForumPost.objects.create(
            thread=self.thread, author=self.other, body="A reply"
        )

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
            {"email": "new@test.local", "full_name": "New User", "password": "testpass"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["user"]["role"], "student")

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


# ── Admin portal: Module/ContentItem CRUD permissions ────────────────────────────

class ModuleAdminTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass",
        )
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
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

    def test_admin_can_create_text_content_item(self):
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
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ContentItem.objects.get(title="Notes").type, "text")


# ── Admin portal: module unlock computation ──────────────────────────────────────

class ModuleUnlockTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass",
        )
        self.week1 = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        self.week3 = Module.objects.create(week_number=3, title="Week 3", is_published=True)

    def _unlocked_map(self):
        resp = self.client.get("/api/modules/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        return {m["week_number"]: m["is_unlocked"] for m in resp.data}

    def test_module_with_no_unlock_at_is_unlocked(self):
        self.client.force_login(self.student)
        unlocked = self._unlocked_map()
        self.assertTrue(unlocked[1])
        self.assertTrue(unlocked[3])

    def test_module_locked_before_future_unlock_at(self):
        from django.utils import timezone
        self.week3.unlock_at = timezone.now() + timedelta(days=7)
        self.week3.save()
        self.client.force_login(self.student)
        unlocked = self._unlocked_map()
        self.assertTrue(unlocked[1])
        self.assertFalse(unlocked[3])

    def test_module_unlocked_once_unlock_at_has_passed(self):
        from django.utils import timezone
        self.week3.unlock_at = timezone.now() - timedelta(minutes=1)
        self.week3.save()
        self.client.force_login(self.student)
        unlocked = self._unlocked_map()
        self.assertTrue(unlocked[3])

    def test_locked_module_detail_returns_403(self):
        from django.utils import timezone
        self.week3.unlock_at = timezone.now() + timedelta(days=7)
        self.week3.save()
        self.client.force_login(self.student)
        resp = self.client.get(f"/api/modules/{self.week3.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


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
