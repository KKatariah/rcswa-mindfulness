from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import ContentCompletion, ContentItem, ForumPost, ForumThread, Module
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


class ForumDisplayNameTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user(
            email="author@test.local", password="testpass", full_name="Real Name"
        )
        self.viewer = User.objects.create_user(
            email="viewer@test.local", password="testpass", full_name="Viewer"
        )
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass",
            full_name="Admin Real Name", role=User.Role.ADMIN,
        )
        self.module = Module.objects.create(
            week_number=1, title="Week 1", is_published=True
        )
        self.thread = ForumThread.objects.create(
            module=self.module, created_by=self.author, title="Test Thread"
        )
        self.post = ForumPost.objects.create(
            thread=self.thread, author=self.author, body="Hello"
        )

    def _thread_author_name(self, viewer):
        self.client.force_login(viewer)
        resp = self.client.get("/api/forum/threads/")
        return next(t for t in resp.data if t["id"] == self.thread.pk)["author_name"]

    def _reply_author_name(self, viewer):
        self.client.force_login(viewer)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        return resp.data["opening_post"]["author_name"]

    # ── Name resolution ────────────────────────────────────────────────────────

    def test_student_sees_display_name_when_set(self):
        self.author.display_name = "Ghost Writer"
        self.author.save(update_fields=["display_name"])
        self.assertEqual(self._thread_author_name(self.viewer), "Ghost Writer")
        self.assertEqual(self._reply_author_name(self.viewer), "Ghost Writer")

    def test_student_sees_full_name_when_display_name_not_set(self):
        self.assertEqual(self._thread_author_name(self.viewer), "Real Name")
        self.assertEqual(self._reply_author_name(self.viewer), "Real Name")

    def test_admin_sees_full_name_even_when_display_name_is_set(self):
        self.author.display_name = "Ghost Writer"
        self.author.save(update_fields=["display_name"])
        self.assertEqual(self._thread_author_name(self.admin), "Real Name")
        self.assertEqual(self._reply_author_name(self.admin), "Real Name")

    def test_null_author_renders_deleted_user(self):
        self.post.author = None
        self.post.save()
        self.client.force_login(self.viewer)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertEqual(resp.data["opening_post"]["author_name"], "Deleted user")

    def test_clearing_display_name_falls_back_to_full_name(self):
        self.author.display_name = "Ghost Writer"
        self.author.save(update_fields=["display_name"])
        self.assertEqual(self._thread_author_name(self.viewer), "Ghost Writer")

        self.author.display_name = ""
        self.author.save(update_fields=["display_name"])
        self.assertEqual(self._thread_author_name(self.viewer), "Real Name")

    # ── Profile endpoint ───────────────────────────────────────────────────────

    def test_user_can_update_own_display_name(self):
        self.client.force_login(self.author)
        resp = self.client.patch(
            f"/api/users/{self.author.pk}/",
            {"display_name": "Ghost Writer"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.author.refresh_from_db()
        self.assertEqual(self.author.display_name, "Ghost Writer")

    def test_user_cannot_update_another_users_display_name(self):
        self.client.force_login(self.viewer)
        resp = self.client.patch(
            f"/api/users/{self.author.pk}/",
            {"display_name": "Hijacked"},
            content_type="application/json",
        )
        # Queryset scoping hides other users entirely, so 404 rather than 403.
        self.assertIn(resp.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))
        self.author.refresh_from_db()
        self.assertEqual(self.author.display_name, "")

    def test_clearing_display_name_via_api_falls_back_to_full_name(self):
        self.author.display_name = "Ghost Writer"
        self.author.save(update_fields=["display_name"])

        self.client.force_login(self.author)
        resp = self.client.patch(
            f"/api/users/{self.author.pk}/",
            {"display_name": ""},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.author.refresh_from_db()
        self.assertEqual(self.author.display_name, "")
        # Now check the forum shows full_name again
        self.assertEqual(self._thread_author_name(self.viewer), "Real Name")

    def test_user_can_read_own_profile(self):
        self.author.display_name = "Ghost Writer"
        self.author.save(update_fields=["display_name"])
        self.client.force_login(self.author)
        resp = self.client.get(f"/api/users/{self.author.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["display_name"], "Ghost Writer")

    # ── Queryset scoping ───────────────────────────────────────────────────────

    def test_student_list_sees_only_themselves(self):
        self.client.force_login(self.viewer)
        resp = self.client.get("/api/users/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [u["id"] for u in resp.data]
        self.assertEqual(ids, [self.viewer.pk])

    def test_student_retrieve_other_user_returns_404(self):
        self.client.force_login(self.viewer)
        resp = self.client.get(f"/api/users/{self.author.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_list_sees_all_users(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/api/users/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {u["id"] for u in resp.data}
        self.assertIn(self.author.pk, ids)
        self.assertIn(self.viewer.pk, ids)
        self.assertIn(self.admin.pk, ids)
