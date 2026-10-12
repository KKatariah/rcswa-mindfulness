"""Forum threads and posts, the rules agreement, archiving and moderation."""

from datetime import date, timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework import status

from ..models import (
    Cohort, ContentItem, Enrollment, ForumFlag, ForumPost, ForumRulesRevision, ForumThread, Module,
)
from ..serializers import ForumPostSerializer
from .base import User, APITestCase, _enroll


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
        User.objects.filter(pk__in=[self.student.pk, self.other.pk]).update(
            forum_rules_accepted_at=timezone.now()
        )
        self.student.refresh_from_db()
        self.other.refresh_from_db()
        _enroll(self.student, self.other)
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

    def test_admin_posting_not_rate_limited(self):
        # The client shows admins no posting cooldown, so the server mustn't throttle them either.
        self.client.force_login(self.admin)
        for i in range(10):
            resp = self.client.post(
                "/api/forum/posts/", {"thread": self.thread.pk, "body": f"reply {i}"},
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

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
        thread_data = next(t for t in resp.data["results"] if t["id"] == self.thread.pk)
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
        thread_data = next(t for t in resp.data["results"] if t["id"] == new_thread.pk)
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
        thread_data = next(t for t in resp.data["results"] if t["id"] == self.thread.pk)
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
        thread_data = next(t for t in resp.data["results"] if t["id"] == self.thread.pk)
        self.assertTrue(thread_data["can_edit"])

    def test_can_edit_false_for_non_author(self):
        self.client.force_login(self.other)
        resp = self.client.get("/api/forum/threads/")
        thread_data = next(t for t in resp.data["results"] if t["id"] == self.thread.pk)
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

    # ── is_own / is_thread_author flags ────────────────────────────────────────

    def test_is_own_and_is_thread_author_flags(self):
        mine = ForumPost.objects.create(thread=self.thread, author=self.student, body="Thread author replying")
        self.client.force_login(self.other)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertFalse(resp.data["is_own"])
        replies = {p["id"]: p for p in resp.data["replies"]}
        self.assertTrue(replies[self.reply.pk]["is_own"])
        self.assertFalse(replies[self.reply.pk]["is_thread_author"])
        self.assertFalse(replies[mine.pk]["is_own"])
        self.assertTrue(replies[mine.pk]["is_thread_author"])

    def test_admin_is_own_false_on_others_posts(self):
        """Unlike can_edit, is_own stays false for an admin viewing someone else's post."""
        self.client.force_login(self.admin)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertFalse(resp.data["is_own"])
        self.assertFalse(resp.data["replies"][0]["is_own"])

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
        ids = [t["id"] for t in resp.data["results"]]
        self.assertEqual(ids[0], self.thread.pk)

    def test_is_pinned_in_list_response(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/forum/threads/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        thread_data = next(t for t in resp.data["results"] if t["id"] == self.thread.pk)
        self.assertIn("is_pinned", thread_data)
        self.assertFalse(thread_data["is_pinned"])

    @override_settings(FORUM_MAX_PINNED_THREADS=3)
    def test_admin_pin_order_choices_use_configured_limit_without_zero(self):
        from ..admin import ForumThreadAdminForm

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
        from ..admin import ForumThreadAdmin

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
        from ..admin import ForumThreadAdminForm

        form = ForumThreadAdminForm(
            data=self._forum_thread_admin_form_data(is_pinned=False, pin_order=""),
            instance=self.thread,
        )
        self.assertTrue(form.is_valid(), form.errors)
        self.assertFalse(form.cleaned_data["is_pinned"])
        self.assertEqual(form.cleaned_data["pin_order"], 0)

    def test_admin_rejects_pin_order_without_is_pinned(self):
        from ..admin import ForumThreadAdminForm

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
        from ..admin import ForumThreadAdminForm

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
        from ..admin import ForumPostAdmin

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
        ids = [t["id"] for t in resp.data["results"] if t["is_pinned"]]
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


class ForumArchiveTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass",
            forum_rules_accepted_at=timezone.now(),
        )
        self.module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        self.thread = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Existing Thread",
        )
        ForumPost.objects.create(thread=self.thread, author=self.student, body="Opening")
        # Approved through a cohort that has already ended, so the program still
        # counts as inactive until a test adds a running cohort.
        past = Cohort.objects.create(
            name="Past Cohort", year=2025,
            start_date=date.today() - timedelta(days=200),
            end_date=date.today() - timedelta(days=150),
        )
        Enrollment.objects.create(user=self.student, cohort=past, status=Enrollment.Status.ACTIVE)

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

    def _join_active_cohort(self):
        cohort = Cohort.objects.create(
            name="Active Cohort", year=2026,
            start_date=date.today() - timedelta(days=7),
            end_date=date.today() + timedelta(days=49),
        )
        Enrollment.objects.create(user=self.student, cohort=cohort, status=Enrollment.Status.ACTIVE)
        return cohort

    def test_thread_create_allowed_when_cohort_active(self):
        self._join_active_cohort()
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
        # The student's own cohort has ended, so the program starts out inactive.
        self.assertFalse(self.client.get("/api/program-status/").data["is_active"])

        self._join_active_cohort()
        self.assertTrue(self.client.get("/api/program-status/").data["is_active"])

    def test_another_cohort_running_does_not_reopen_an_ended_cohort(self):
        Cohort.objects.create(
            name="Someone Else's Cohort", year=2026,
            start_date=date.today() - timedelta(days=7),
            end_date=date.today() + timedelta(days=49),
        )
        self.client.force_login(self.student)
        self.assertFalse(self.client.get("/api/program-status/").data["is_active"])
        resp = self.client.post("/api/forum/threads/", {"body": "New"}, content_type="application/json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.post(
            "/api/forum/posts/", {"thread": self.thread.pk, "body": "A reply"}, content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class ForumRulesTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass", full_name="Student One"
        )
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass",
            full_name="Admin User", role=User.Role.ADMIN,
        )
        _enroll(self.student)

    def test_forum_blocked_until_rules_accepted(self):
        self.client.force_login(self.student)
        self.assertEqual(
            self.client.get("/api/forum/threads/").status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(
            self.client.post(
                "/api/forum/threads/", {"body": "Hi"}, content_type="application/json"
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertFalse(self.client.get("/api/user/").data["user"]["forum_rules_accepted"])

        resp = self.client.post("/api/forum/accept-rules/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data["user"]["forum_rules_accepted"])
        self.student.refresh_from_db()
        self.assertIsNotNone(self.student.forum_rules_accepted_at)
        self.assertEqual(self.client.get("/api/forum/threads/").status_code, status.HTTP_200_OK)

    def test_accepting_again_keeps_original_timestamp(self):
        self.client.force_login(self.student)
        self.client.post("/api/forum/accept-rules/")
        self.student.refresh_from_db()
        first = self.student.forum_rules_accepted_at
        self.client.post("/api/forum/accept-rules/")
        self.student.refresh_from_db()
        self.assertEqual(self.student.forum_rules_accepted_at, first)

    def test_admin_not_required_to_accept(self):
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get("/api/forum/threads/").status_code, status.HTTP_200_OK)

    def test_accept_requires_login(self):
        self.assertIn(
            self.client.post("/api/forum/accept-rules/").status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )


class ForumRulesEditingTests(APITestCase):
    """Admins change the rules; students who agreed to an older version are asked again."""

    NEW_RULES = [{"title": "Be kind", "body": "Always."}, {"title": "No spam", "body": ""}]

    def setUp(self):
        self.student = User.objects.create_user(email="student@test.local", password="testpass")
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN
        )
        _enroll(self.student)
        # Agreed a while ago, so any change saved during the test is clearly newer.
        self.student.forum_rules_accepted_at = timezone.now() - timedelta(minutes=5)
        self.student.save(update_fields=["forum_rules_accepted_at"])

    def _save_rules(self, rules=None, **extra):
        self.client.force_login(self.admin)
        return self.client.post(
            "/api/forum/rules/", {"rules": rules or self.NEW_RULES, **extra}, format="json"
        )

    def test_initial_rules_are_seeded_and_already_agreed_to(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/forum/rules/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data["rules"]), 8)
        self.assertEqual(resp.data["rules"][0]["title"], "Lead with kindness")
        self.assertIsNone(resp.data["updated_by_name"])
        self.assertTrue(self.client.get("/api/user/").data["user"]["forum_rules_accepted"])

    def test_rules_readable_before_agreeing(self):
        newcomer = User.objects.create_user(email="new@test.local", password="testpass")
        _enroll(newcomer)
        self.client.force_login(newcomer)
        self.assertEqual(self.client.get("/api/forum/rules/").status_code, status.HTTP_200_OK)

    def test_students_cannot_change_rules(self):
        self.client.force_login(self.student)
        resp = self.client.post("/api/forum/rules/", {"rules": self.NEW_RULES}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(ForumRulesRevision.objects.count(), 1)

    def test_change_requires_students_to_agree_again(self):
        resp = self._save_rules()
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["rules"], self.NEW_RULES)
        self.assertEqual(resp.data["updated_by_name"], str(self.admin))

        self.client.force_login(self.student)
        self.assertEqual(self.client.get("/api/forum/rules/").data["rules"], self.NEW_RULES)
        user = self.client.get("/api/user/").data["user"]
        self.assertFalse(user["forum_rules_accepted"])
        self.assertTrue(user["forum_rules_outdated"])
        blocked = self.client.get("/api/forum/threads/")
        self.assertEqual(blocked.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("forum rules have changed", str(blocked.data["detail"]))

        accepted = self.client.post(
            "/api/forum/accept-rules/", {"revision": ForumRulesRevision.current().pk}, format="json"
        )
        self.assertEqual(accepted.status_code, status.HTTP_200_OK)
        self.assertTrue(accepted.data["user"]["forum_rules_accepted"])
        self.assertFalse(accepted.data["user"]["forum_rules_outdated"])
        self.assertEqual(self.client.get("/api/forum/threads/").status_code, status.HTTP_200_OK)

    def test_minor_change_keeps_existing_agreement(self):
        self.assertEqual(self._save_rules(requires_reaccept=False).status_code, status.HTTP_200_OK)
        self.client.force_login(self.student)
        self.assertEqual(self.client.get("/api/forum/threads/").status_code, status.HTTP_200_OK)

    def test_minor_change_after_major_one_still_needs_agreement(self):
        self._save_rules()
        self._save_rules(rules=[{"title": "Be kind!", "body": "Always."}], requires_reaccept=False)
        self.client.force_login(self.student)
        self.assertEqual(self.client.get("/api/forum/threads/").status_code, status.HTTP_403_FORBIDDEN)

    def test_agreeing_to_a_stale_version_is_refused(self):
        shown = ForumRulesRevision.current().pk
        self._save_rules()
        self.client.force_login(self.student)
        resp = self.client.post("/api/forum/accept-rules/", {"revision": shown}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(self.client.get("/api/forum/threads/").status_code, status.HTTP_403_FORBIDDEN)

    def test_invalid_rules_rejected(self):
        for rules in ([], [{"title": "", "body": "x"}], [{"title": "x" * 121}], [{"title": "r"}] * 21):
            with self.subTest(count=len(rules)):
                self.client.force_login(self.admin)
                resp = self.client.post("/api/forum/rules/", {"rules": rules}, format="json")
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(ForumRulesRevision.objects.count(), 1)

    def test_whitespace_trimmed_and_body_optional(self):
        resp = self._save_rules(rules=[{"title": "  Be kind  "}])
        self.assertEqual(resp.data["rules"], [{"title": "Be kind", "body": ""}])

    def test_admin_overview_shows_outdated_agreement(self):
        self._save_rules()
        overview = self.client.get(f"/api/users/{self.student.pk}/overview/").data["user"]
        self.assertTrue(overview["forum_rules_outdated"])


class ForumRulesBypassTests(APITestCase):
    """Every route a student might use to reach the forum, or to mark the
    rules as accepted without going through the accept endpoint."""

    def setUp(self):
        # A student who posted before the rules existed, so they own content
        # they might try to edit or delete without having agreed.
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass", full_name="Student One"
        )
        self.module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        self.thread = ForumThread.objects.create(
            module=self.module, created_by=self.student, title="Old thread"
        )
        self.opening = ForumPost.objects.create(
            thread=self.thread, author=self.student, body="Old opening", is_head_post=True
        )
        self.thread.opened_by = self.opening
        self.thread.save(update_fields=["opened_by"])
        self.reply = ForumPost.objects.create(
            thread=self.thread, author=self.student, body="Old reply"
        )
        _enroll(self.student)

    def _forum_requests(self):
        t, op, r = self.thread.pk, self.opening.pk, self.reply.pk
        return [
            ("get", "/api/forum/threads/", None),
            ("head", "/api/forum/threads/", None),
            ("get", f"/api/forum/threads/{t}/", None),
            ("get", f"/api/forum/threads/?module={self.module.pk}", None),
            ("post", "/api/forum/threads/", {"body": "New"}),
            ("patch", f"/api/forum/threads/{t}/", {"is_pinned": True}),
            ("delete", f"/api/forum/threads/{t}/", None),
            ("post", "/api/forum/posts/", {"thread": t, "body": "Reply"}),
            ("patch", f"/api/forum/posts/{op}/", {"body": "Edited"}),
            ("patch", f"/api/forum/posts/{r}/", {"body": "Edited"}),
            ("delete", f"/api/forum/posts/{r}/", None),
            ("post", f"/api/forum/posts/{op}/flag/", {"reason": "Rude"}),
        ]

    def _assert_all_blocked(self):
        for method, url, data in self._forum_requests():
            with self.subTest(method=method, url=url):
                resp = getattr(self.client, method)(url, data, format="json")
                self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
                if method != "head":
                    self.assertIn("forum rules", str(resp.data["detail"]))
        # Nothing was created, changed or deleted.
        self.assertEqual(ForumThread.objects.count(), 1)
        self.assertEqual(ForumPost.objects.filter(is_deleted=False).count(), 2)
        self.opening.refresh_from_db()
        self.reply.refresh_from_db()
        self.thread.refresh_from_db()
        self.assertEqual(self.opening.body, "Old opening")
        self.assertEqual(self.reply.body, "Old reply")
        self.assertFalse(self.thread.is_pinned)

    def test_every_forum_endpoint_blocked_with_session_auth(self):
        self.client.force_login(self.student)
        self._assert_all_blocked()

    def test_every_forum_endpoint_blocked_with_token_auth(self):
        from ..models import AuthToken
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {AuthToken.issue(self.student)}")
        self._assert_all_blocked()

    def test_anonymous_forum_access_blocked(self):
        for method, url, data in self._forum_requests():
            with self.subTest(method=method, url=url):
                resp = getattr(self.client, method)(url, data, format="json")
                self.assertIn(
                    resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
                )

    def test_flag_cannot_be_set_through_profile_endpoints(self):
        self.client.force_login(self.student)
        payload = {
            "display_name": "Sneaky",
            "forum_rules_accepted_at": "2026-01-01T00:00:00Z",
            "forum_rules_accepted": True,
        }
        self.client.patch("/api/profile/", payload, format="json")
        self.client.patch(f"/api/users/{self.student.pk}/", payload, format="json")
        self.student.refresh_from_db()
        self.assertEqual(self.student.display_name, "Sneaky")  # the request itself went through
        self.assertIsNone(self.student.forum_rules_accepted_at)
        self.assertEqual(
            self.client.get("/api/forum/threads/").status_code, status.HTTP_403_FORBIDDEN
        )

    def test_flag_and_role_cannot_be_set_at_registration(self):
        resp = self.client.post(
            "/api/register/",
            {
                "email": "new@test.local", "full_name": "New", "password": "Calm-River-42!",
                "forum_rules_accepted_at": "2026-01-01T00:00:00Z", "role": "admin",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        new = User.objects.get(email="new@test.local")
        self.assertIsNone(new.forum_rules_accepted_at)
        self.assertEqual(new.role, User.Role.STUDENT)

    def test_student_cannot_promote_self_to_admin_to_skip_rules(self):
        self.client.force_login(self.student)
        self.client.patch(
            f"/api/users/{self.student.pk}/", {"role": "admin", "is_staff": True}, format="json"
        )
        self.client.patch("/api/profile/", {"role": "admin", "is_staff": True}, format="json")
        self.student.refresh_from_db()
        self.assertEqual(self.student.role, User.Role.STUDENT)
        self.assertFalse(self.student.is_staff)
        self.assertEqual(
            self.client.get("/api/forum/threads/").status_code, status.HTTP_403_FORBIDDEN
        )

    def test_accept_endpoint_only_takes_post(self):
        self.client.force_login(self.student)
        for method in ("get", "put", "patch", "delete"):
            with self.subTest(method=method):
                resp = getattr(self.client, method)("/api/forum/accept-rules/")
                self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.student.refresh_from_db()
        self.assertIsNone(self.student.forum_rules_accepted_at)

    def test_accept_endpoint_enforces_csrf_for_session_logins(self):
        # Stops another site from silently accepting on a logged-in student's behalf.
        from rest_framework.test import APIClient

        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.student)
        resp = client.post("/api/forum/accept-rules/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.student.refresh_from_db()
        self.assertIsNone(self.student.forum_rules_accepted_at)

    def test_acceptance_is_per_user(self):
        other = User.objects.create_user(email="other@test.local", password="testpass")
        _enroll(other)
        self.client.force_login(other)
        self.client.post("/api/forum/accept-rules/")
        self.client.force_login(self.student)
        self.assertEqual(
            self.client.get("/api/forum/threads/").status_code, status.HTTP_403_FORBIDDEN
        )

    def test_demoted_admin_must_accept(self):
        admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN
        )
        admin.role = User.Role.STUDENT
        admin.save()
        _enroll(admin)
        self.client.force_login(admin)
        self.assertEqual(
            self.client.get("/api/forum/threads/").status_code, status.HTTP_403_FORBIDDEN
        )

    def test_unaccepted_student_cannot_see_forum_stats(self):
        self.client.force_login(self.student)
        self.assertEqual(
            self.client.get("/api/dashboard/stats/").status_code, status.HTTP_403_FORBIDDEN
        )


class ForumEdgeCaseTests(APITestCase):
    def test_pinned_thread_survives_author_deletion(self):
        admin = User.objects.create_user(email="admin@test.local", password="testpass", role=User.Role.ADMIN)
        author = User.objects.create_user(
            email="author@test.local", password="testpass", forum_rules_accepted_at=timezone.now()
        )
        reader = User.objects.create_user(
            email="reader@test.local", password="testpass", forum_rules_accepted_at=timezone.now()
        )
        _enroll(author, reader)
        self.client.force_login(author)
        tid = self.client.post("/api/forum/threads/", {"body": "Pinned by admin"}, format="json").data["id"]
        self.client.force_login(admin)
        self.client.patch(f"/api/forum/threads/{tid}/", {"is_pinned": True}, format="json")
        self.client.delete(f"/api/users/{author.pk}/")

        self.client.force_login(reader)
        listing = self.client.get("/api/forum/threads/")
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertTrue(listing.data["results"][0]["is_pinned"])
        detail = self.client.get(f"/api/forum/threads/{tid}/")
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data["body"], "Pinned by admin")

    def test_title_cut_never_splits_an_emoji(self):
        from ..views import _derive_title
        family = "\U0001F468‍\U0001F469‍\U0001F467"
        thumbs = "\U0001F44D\U0001F3FD"
        for filler in range(55, 62):
            for emoji in (family, thumbs):
                title = _derive_title("a" * filler + emoji * 3)
                self.assertFalse(title.endswith("‍"), (filler, title))
                self.assertLessEqual(len(title), 60)
                rest = ("a" * filler + emoji * 3)[len(title):]
                self.assertFalse(rest and rest[0] in ("‍", "\U0001F3FD"), (filler, title))


class ForumModerationTests(APITestCase):
    """Reporting posts, the admin moderation queue, removed posts and forum bans."""

    def setUp(self):
        self.author = User.objects.create_user(email="author@test.local", password="pw", full_name="Ann Author")
        self.reporter = User.objects.create_user(email="reporter@test.local", password="pw", full_name="Rae Reporter")
        self.admin = User.objects.create_user(
            email="admin@test.local", password="pw", full_name="Admin User", role=User.Role.ADMIN,
        )
        User.objects.filter(pk__in=[self.author.pk, self.reporter.pk]).update(forum_rules_accepted_at=timezone.now())
        self.author.refresh_from_db()
        self.reporter.refresh_from_db()
        _enroll(self.author, self.reporter)
        self.thread = ForumThread.objects.create(created_by=self.author, title="Opening")
        self.opening = ForumPost.objects.create(thread=self.thread, author=self.author, body="Opening", is_head_post=True)
        self.thread.opened_by = self.opening
        self.thread.save(update_fields=["opened_by"])
        self.reply = ForumPost.objects.create(thread=self.thread, author=self.author, body="Nasty reply")

    def _flag(self, post, user=None, reason="Unkind"):
        self.client.force_authenticate(user or self.reporter)
        return self.client.post(f"/api/forum/posts/{post.pk}/flag/", {"reason": reason}, format="json")

    def _moderate(self, post, action, **extra):
        self.client.force_authenticate(self.admin)
        return self.client.post(f"/api/forum/posts/{post.pk}/moderate/", {"action": action, **extra}, format="json")

    # ── Reporting ──────────────────────────────────────────────────────────────

    def test_student_can_report_a_post(self):
        resp = self._flag(self.reply)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        flag = ForumFlag.objects.get()
        self.assertEqual((flag.post, flag.flagged_by, flag.reason), (self.reply, self.reporter, "Unkind"))
        self.assertIsNone(flag.resolved_at)

    def test_reporting_twice_keeps_one_open_report(self):
        self._flag(self.reply)
        resp = self._flag(self.reply, reason="Again")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(ForumFlag.objects.count(), 1)

    def test_can_report_again_after_a_report_is_dealt_with(self):
        self._flag(self.reply)
        self._moderate(self.reply, "dismiss")
        self.assertEqual(self._flag(self.reply).status_code, status.HTTP_201_CREATED)
        self.assertEqual(ForumFlag.objects.filter(resolved_at__isnull=True).count(), 1)

    def test_reason_is_optional_and_capped(self):
        self.assertEqual(self._flag(self.reply, reason="").status_code, status.HTTP_201_CREATED)
        resp = self._flag(self.opening, reason="x" * 501)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_report_own_post(self):
        resp = self._flag(self.reply, user=self.author)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(ForumFlag.objects.exists())

    def test_cannot_report_a_removed_post(self):
        self.reply.soft_delete(self.author)
        self.assertEqual(self._flag(self.reply).status_code, status.HTTP_404_NOT_FOUND)

    def test_reporting_is_rate_limited(self):
        posts = [ForumPost.objects.create(thread=self.thread, author=self.author, body=f"p{i}") for i in range(11)]
        for post in posts[:10]:
            self.assertEqual(self._flag(post).status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._flag(posts[10]).status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_thread_detail_shows_whether_viewer_reported_each_post(self):
        self._flag(self.reply)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertTrue(resp.data["replies"][0]["has_flagged"])
        self.assertFalse(resp.data["opening_post"]["has_flagged"])
        # Someone else's report doesn't show as yours.
        self.client.force_authenticate(self.author)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertFalse(resp.data["replies"][0]["has_flagged"])

    # ── Admin queue ────────────────────────────────────────────────────────────

    def test_moderation_endpoints_are_admin_only(self):
        self.client.force_authenticate(self.reporter)
        for method, url in [
            ("get", "/api/forum/posts/reported/"),
            ("get", "/api/forum/posts/removed/"),
            ("post", f"/api/forum/posts/{self.reply.pk}/moderate/"),
            ("post", f"/api/forum/posts/{self.reply.pk}/restore/"),
            ("post", f"/api/users/{self.author.pk}/forum-ban/"),
            ("delete", f"/api/users/{self.author.pk}/forum-ban/"),
        ]:
            with self.subTest(url=url):
                resp = getattr(self.client, method)(url, {"action": "hide"}, format="json")
                self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.reply.refresh_from_db()
        self.assertFalse(self.reply.is_deleted)

    def test_reported_lists_posts_with_open_reports_and_their_reasons(self):
        other = User.objects.create_user(email="o@test.local", password="pw", full_name="Other")
        User.objects.filter(pk=other.pk).update(forum_rules_accepted_at=timezone.now())
        _enroll(other)
        self._flag(self.reply, reason="Unkind")
        self._flag(self.reply, user=User.objects.get(pk=other.pk), reason="Off topic")
        self._flag(self.opening)
        self._moderate(self.opening, "dismiss")

        resp = self.client.get("/api/forum/posts/reported/")
        self.assertEqual(resp.data["count"], 1)
        post = resp.data["results"][0]
        self.assertEqual(post["id"], self.reply.pk)
        self.assertEqual(post["author"]["email"], "author@test.local")
        self.assertEqual({f["reason"] for f in post["flags"]}, {"Unkind", "Off topic"})

    def test_dismiss_closes_reports_and_leaves_post_up(self):
        self._flag(self.reply)
        resp = self._moderate(self.reply, "dismiss")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.reply.refresh_from_db()
        self.assertFalse(self.reply.is_deleted)
        flag = ForumFlag.objects.get()
        self.assertEqual((flag.resolution, flag.resolved_by), ("dismissed", self.admin))

    def test_hide_removes_reply_from_thread(self):
        self._flag(self.reply)
        self._moderate(self.reply, "hide")
        self.reply.refresh_from_db()
        self.assertTrue(self.reply.is_deleted)
        self.assertEqual(self.reply.deleted_by, self.admin)
        self.assertEqual(ForumFlag.objects.get().resolution, "hidden")
        self.client.force_authenticate(self.reporter)
        resp = self.client.get(f"/api/forum/threads/{self.thread.pk}/")
        self.assertEqual(resp.data["replies"], [])

    def test_hiding_opening_post_removes_the_thread(self):
        self._flag(self.opening)
        self._moderate(self.opening, "hide")
        self.client.force_authenticate(self.reporter)
        self.assertEqual(self.client.get("/api/forum/threads/").data["count"], 0)
        self.assertEqual(self.client.get(f"/api/forum/threads/{self.thread.pk}/").status_code, 404)
        resp = self.client.post("/api/forum/posts/", {"thread": self.thread.pk, "body": "hi"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_ban_hides_post_and_bans_author(self):
        self._flag(self.reply)
        resp = self._moderate(self.reply, "ban", ban_days=7)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data["author"]["forum_banned"])
        self.author.refresh_from_db()
        self.assertTrue(self.author.is_forum_banned)
        self.assertAlmostEqual(
            self.author.forum_banned_until, timezone.now() + timedelta(days=7), delta=timedelta(minutes=1)
        )
        self.reply.refresh_from_db()
        self.assertTrue(self.reply.is_deleted)
        self.assertEqual(ForumFlag.objects.get().resolution, "banned")

    def test_ban_rejects_unknown_length_and_admin_authors(self):
        self._flag(self.reply)
        self.assertEqual(self._moderate(self.reply, "ban", ban_days=3).status_code, status.HTTP_400_BAD_REQUEST)
        admin_post = ForumPost.objects.create(thread=self.thread, author=self.admin, body="Admin here")
        self._flag(admin_post)
        self.assertEqual(self._moderate(admin_post, "ban").status_code, status.HTTP_400_BAD_REQUEST)
        # Nothing changed for either.
        self.author.refresh_from_db()
        admin_post.refresh_from_db()
        self.assertFalse(self.author.is_forum_banned)
        self.assertFalse(admin_post.is_deleted)
        self.assertEqual(ForumFlag.objects.filter(resolved_at__isnull=True).count(), 2)

    def test_unknown_action_rejected(self):
        self.assertEqual(self._moderate(self.reply, "explode").status_code, status.HTTP_400_BAD_REQUEST)

    # ── Removed posts ──────────────────────────────────────────────────────────

    def test_deleting_a_thread_keeps_it_for_admins_to_restore(self):
        self.client.force_authenticate(self.author)
        self.assertEqual(self.client.delete(f"/api/forum/threads/{self.thread.pk}/").status_code, 204)
        self.assertTrue(ForumThread.objects.filter(pk=self.thread.pk).exists())
        self.assertEqual(self.client.get("/api/forum/threads/").data["count"], 0)

        self.client.force_authenticate(self.admin)
        removed = self.client.get("/api/forum/posts/removed/").data["results"]
        self.assertEqual([p["id"] for p in removed], [self.opening.pk])
        self.assertTrue(removed[0]["removed_by_author"])

        self.assertEqual(self.client.post(f"/api/forum/posts/{self.opening.pk}/restore/").status_code, 200)
        self.assertEqual(self.client.get("/api/forum/threads/").data["count"], 1)
        self.assertEqual(self.client.get("/api/forum/posts/removed/").data["count"], 0)

    def test_removed_lists_deleted_replies_with_who_removed_them(self):
        self.client.force_authenticate(self.admin)
        self.client.delete(f"/api/forum/posts/{self.reply.pk}/")
        removed = self.client.get("/api/forum/posts/removed/").data["results"]
        self.assertEqual(removed[0]["id"], self.reply.pk)
        self.assertFalse(removed[0]["removed_by_author"])
        self.assertEqual(removed[0]["deleted_by_name"], "Admin User")

    def test_restore_rejects_a_post_that_is_not_removed(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/forum/posts/{self.reply.pk}/restore/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # ── Bans ───────────────────────────────────────────────────────────────────

    def _ban(self, days=None):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/users/{self.author.pk}/forum-ban/", {"days": days}, format="json")
        # force_authenticate hands requests this object, so it must see the ban.
        self.author.refresh_from_db()
        return resp

    def test_banned_user_can_read_but_not_post_edit_or_report(self):
        self._ban()
        self.client.force_authenticate(self.author)
        self.assertEqual(self.client.get("/api/forum/threads/").status_code, 200)
        for method, url, data in [
            ("post", "/api/forum/threads/", {"body": "New"}),
            ("post", "/api/forum/posts/", {"thread": self.thread.pk, "body": "Reply"}),
            ("patch", f"/api/forum/posts/{self.reply.pk}/", {"body": "Edited"}),
            ("post", f"/api/forum/posts/{ForumPost.objects.create(thread=self.thread, body='x').pk}/flag/", {}),
        ]:
            with self.subTest(url=url):
                resp = getattr(self.client, method)(url, data, format="json")
                self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
                self.assertIn("banned", str(resp.data["detail"]))
        # They can still take down their own post.
        self.assertEqual(self.client.delete(f"/api/forum/posts/{self.reply.pk}/").status_code, 204)

    def test_ban_shows_on_the_users_own_profile(self):
        self._ban(days=1)
        self.client.force_authenticate(self.author)
        user = self.client.get("/api/user/").data["user"]
        self.assertTrue(user["forum_banned"])
        self.assertIsNotNone(user["forum_banned_until"])

    def test_ban_expires_on_its_own(self):
        self._ban(days=1)
        User.objects.filter(pk=self.author.pk).update(forum_banned_until=timezone.now() - timedelta(minutes=1))
        self.author.refresh_from_db()
        self.client.force_authenticate(self.author)
        resp = self.client.post("/api/forum/posts/", {"thread": self.thread.pk, "body": "Back"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/users/?forum_banned=true").data["count"], 0)

    def test_lifting_a_ban(self):
        self._ban()
        self.assertEqual(self.client.get("/api/users/?forum_banned=true").data["count"], 1)
        resp = self.client.delete(f"/api/users/{self.author.pk}/forum-ban/")
        self.assertFalse(resp.data["forum_banned"])
        self.assertEqual(self.client.get("/api/users/?forum_banned=true").data["count"], 0)

    def test_admin_cannot_ban_self_or_another_admin(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/users/{self.admin.pk}/forum-ban/", {"days": None}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        other_admin = User.objects.create_user(email="a2@test.local", password="pw", role=User.Role.ADMIN)
        resp = self.client.post(f"/api/users/{other_admin.pk}/forum-ban/", {"days": 7}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_dashboard_counts_reported_posts_and_skips_removed_threads(self):
        self._flag(self.reply)
        self.client.force_authenticate(self.admin)
        forum = self.client.get("/api/dashboard/stats/").data["forum_activity"]
        self.assertEqual((forum["thread_count"], forum["reported_post_count"]), (1, 1))
        self.opening.soft_delete(self.admin)
        forum = self.client.get("/api/dashboard/stats/").data["forum_activity"]
        self.assertEqual((forum["thread_count"], forum["post_count"]), (0, 0))


class ForumCohortScopingTests(APITestCase):
    """Students only see (and reply to) threads from their own cohort; admins see them all."""

    def setUp(self):
        today = date.today()
        self.cohort_a = Cohort.objects.create(
            name="A", year=today.year, start_date=today - timedelta(days=30), end_date=today + timedelta(days=30),
        )
        self.cohort_b = Cohort.objects.create(
            name="B", year=today.year, start_date=today - timedelta(days=10), end_date=today + timedelta(days=50),
        )
        self.student_a = self._student("a@test.local", self.cohort_a)
        self.student_b = self._student("b@test.local", self.cohort_b)
        self.admin = User.objects.create_user(email="admin@test.local", password="pw", role=User.Role.ADMIN)
        self.thread_a = self._thread(self.student_a, self.cohort_a)
        self.thread_b = self._thread(self.student_b, self.cohort_b)

    def _student(self, email, cohort):
        user = User.objects.create_user(email=email, password="pw")
        User.objects.filter(pk=user.pk).update(forum_rules_accepted_at=timezone.now())
        user.refresh_from_db()
        Enrollment.objects.create(user=user, cohort=cohort, status=Enrollment.Status.ACTIVE)
        return user

    def _thread(self, author, cohort):
        thread = ForumThread.objects.create(created_by=author, title="T", cohort=cohort)
        head = ForumPost.objects.create(thread=thread, author=author, body="Hello", is_head_post=True)
        thread.opened_by = head
        thread.save(update_fields=["opened_by"])
        return thread

    def _listed_ids(self, query=""):
        return {t["id"] for t in self.client.get(f"/api/forum/threads/{query}").data["results"]}

    def test_student_lists_only_own_cohort(self):
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._listed_ids(), {self.thread_a.pk})

    def test_student_cannot_open_or_reply_to_other_cohort_thread(self):
        self.client.force_authenticate(self.student_a)
        resp = self.client.get(f"/api/forum/threads/{self.thread_b.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        resp = self.client.post("/api/forum/posts/", {"thread": self.thread_b.pk, "body": "hi"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(ForumPost.objects.filter(thread=self.thread_b, author=self.student_a).exists())

    def test_student_cannot_flag_post_in_other_cohort(self):
        self.client.force_authenticate(self.student_a)
        resp = self.client.post(
            f"/api/forum/posts/{self.thread_b.opened_by_id}/flag/", {"reason": "x"}, format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_threads_without_cohort_are_visible_to_everyone(self):
        legacy = self._thread(self.student_b, None)
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._listed_ids(), {self.thread_a.pk, legacy.pk})

    def test_new_student_thread_goes_to_their_cohort(self):
        self.client.force_authenticate(self.student_b)
        resp = self.client.post("/api/forum/threads/", {"body": "New"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(ForumThread.objects.get(pk=resp.data["id"]).cohort, self.cohort_b)

    def test_admin_thread_goes_to_running_cohort(self):
        # Both cohorts are running; the more recently started one is "the" active cohort.
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/forum/threads/", {"body": "Announcement"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(ForumThread.objects.get(pk=resp.data["id"]).cohort, self.cohort_b)

    def test_admin_sees_all_cohorts_and_can_filter(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self._listed_ids(), {self.thread_a.pk, self.thread_b.pk})
        self.assertEqual(self._listed_ids(f"?cohort={self.cohort_a.pk}"), {self.thread_a.pk})

    def test_student_cohort_filter_param_is_ignored(self):
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._listed_ids(f"?cohort={self.cohort_b.pk}"), {self.thread_a.pk})

    def _reply(self, thread, body="hi"):
        return self.client.post("/api/forum/posts/", {"thread": thread.pk, "body": body}, format="json")

    def test_student_can_reply_in_own_cohort_and_to_threads_without_cohort(self):
        legacy = self._thread(self.student_b, None)
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._reply(self.thread_a).status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._reply(legacy).status_code, status.HTTP_201_CREATED)

    def test_search_does_not_reach_other_cohorts(self):
        self._thread(self.student_b, self.cohort_b).posts.update(body="unique-needle")
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._listed_ids("?search=unique-needle"), set())
        self.client.force_authenticate(self.admin)
        self.assertEqual(len(self._listed_ids("?search=unique-needle")), 1)

    def test_search_by_author_name_does_not_reach_other_cohorts(self):
        User.objects.filter(pk=self.student_b.pk).update(display_name="Bobby")
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._listed_ids("?search=Bobby"), set())

    def test_student_cannot_edit_or_delete_other_cohort_content(self):
        reply = ForumPost.objects.create(thread=self.thread_b, author=self.student_b, body="reply")
        self.client.force_authenticate(self.student_a)
        resp = self.client.patch(f"/api/forum/threads/{self.thread_b.pk}/", {"title": "x"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        resp = self.client.delete(f"/api/forum/threads/{self.thread_b.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        resp = self.client.patch(f"/api/forum/posts/{reply.pk}/", {"body": "x"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(ForumPost.objects.get(pk=reply.pk).body, "reply")

    def test_reply_to_other_cohort_thread_does_not_reveal_it_was_removed(self):
        # The same answer whether or not the hidden thread's opening post was deleted.
        self.thread_b.opened_by.soft_delete(self.admin)
        self.client.force_authenticate(self.student_a)
        resp = self._reply(self.thread_b)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        missing = self.client.post("/api/forum/posts/", {"thread": 999999, "body": "hi"}, format="json")
        self.assertEqual(str(resp.data["thread"]).replace(str(self.thread_b.pk), "N"),
                         str(missing.data["thread"]).replace("999999", "N"))

    def test_replying_under_a_hidden_post_looks_like_a_missing_post(self):
        self.client.force_authenticate(self.student_a)
        hidden = self.client.post("/api/forum/posts/", {
            "thread": self.thread_a.pk, "parent_post": self.thread_b.opened_by_id, "body": "x",
        }, format="json")
        missing = self.client.post("/api/forum/posts/", {
            "thread": self.thread_a.pk, "parent_post": 999999, "body": "x",
        }, format="json")
        self.assertEqual(hidden.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(str(hidden.data["parent_post"]).replace(str(self.thread_b.opened_by_id), "N"),
                         str(missing.data["parent_post"]).replace("999999", "N"))

    def test_admin_can_reply_in_any_cohort(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self._reply(self.thread_a).status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._reply(self.thread_b).status_code, status.HTTP_201_CREATED)

    def test_student_who_moves_cohort_sees_the_new_cohort(self):
        Enrollment.objects.create(user=self.student_a, cohort=self.cohort_b, status=Enrollment.Status.ACTIVE)
        Enrollment.objects.filter(user=self.student_a, cohort=self.cohort_a).update(
            status=Enrollment.Status.COMPLETED,
        )
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._listed_ids(), {self.thread_b.pk})

    def test_admin_thread_without_running_cohort_has_none(self):
        Cohort.objects.all().delete()  # with no cohorts at all the forum stays open
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/forum/threads/", {"body": "Hello"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertIsNone(ForumThread.objects.get(pk=resp.data["id"]).cohort)

    def test_deleting_a_cohort_keeps_its_threads(self):
        self.cohort_b.delete()
        self.thread_b.refresh_from_db()
        self.assertIsNone(self.thread_b.cohort)

    def test_bad_cohort_filter_is_a_400(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/forum/threads/?cohort=abc")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_pin_limit_is_per_cohort(self):
        from django.conf import settings
        self.client.force_authenticate(self.admin)
        for _ in range(settings.FORUM_MAX_PINNED_THREADS):
            t = self._thread(self.student_a, self.cohort_a)
            resp = self.client.patch(f"/api/forum/threads/{t.pk}/", {"is_pinned": True}, format="json")
            self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        resp = self.client.patch(f"/api/forum/threads/{self.thread_a.pk}/", {"is_pinned": True}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        # Cohort A being full doesn't stop pinning in cohort B, which starts at position 1.
        resp = self.client.patch(f"/api/forum/threads/{self.thread_b.pk}/", {"is_pinned": True}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["pin_order"], 1)

    def test_unpinning_reorders_only_its_own_cohort(self):
        self.client.force_authenticate(self.admin)
        a2 = self._thread(self.student_a, self.cohort_a)
        for t in (self.thread_a, a2, self.thread_b):
            self.client.patch(f"/api/forum/threads/{t.pk}/", {"is_pinned": True}, format="json")
        # A newly pinned thread goes to the top of its own cohort's pins.
        orders = dict(ForumThread.objects.filter(is_pinned=True).values_list("pk", "pin_order"))
        self.assertEqual(orders, {a2.pk: 1, self.thread_a.pk: 2, self.thread_b.pk: 1})
        self.client.patch(f"/api/forum/threads/{a2.pk}/", {"is_pinned": False}, format="json")
        orders = dict(ForumThread.objects.filter(is_pinned=True).values_list("pk", "pin_order"))
        self.assertEqual(orders, {self.thread_a.pk: 1, self.thread_b.pk: 1})

    def test_django_admin_pin_limit_is_per_cohort(self):
        from django.conf import settings
        from ..admin import ForumThreadAdminForm
        for _ in range(settings.FORUM_MAX_PINNED_THREADS):
            self._thread(self.student_a, self.cohort_a)
        ForumThread.objects.filter(cohort=self.cohort_a).exclude(pk=self.thread_a.pk).update(is_pinned=True)

        def form(thread, cohort):
            return ForumThreadAdminForm(instance=thread, data={
                "cohort": cohort.pk, "created_by": thread.created_by_id, "title": thread.title,
                "is_pinned": "on", "pin_order": "1", "opened_by": thread.opened_by_id,
            })

        full = form(self.thread_a, self.cohort_a)
        self.assertFalse(full.is_valid())
        self.assertIn("is_pinned", full.errors)
        self.assertTrue(form(self.thread_b, self.cohort_b).is_valid())
        # Moving a thread into the full cohort while pinning it is also refused.
        self.assertFalse(form(self.thread_b, self.cohort_a).is_valid())

    def _end(self, cohort):
        Cohort.objects.filter(pk=cohort.pk).update(end_date=date.today() - timedelta(days=1))

    def _archived(self, thread):
        return self.client.get(f"/api/forum/threads/{thread.pk}/").data["is_archived"]

    def test_ended_cohort_is_read_only_while_another_runs(self):
        self._end(self.cohort_a)
        self.client.force_authenticate(self.student_a)
        self.assertFalse(self.client.get("/api/program-status/").data["is_active"])
        self.assertEqual(self._listed_ids(), {self.thread_a.pk})  # still readable
        self.assertTrue(self._archived(self.thread_a))
        resp = self.client.post("/api/forum/threads/", {"body": "New"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self._reply(self.thread_a).status_code, status.HTTP_403_FORBIDDEN)

        # Cohort B is unaffected.
        self.client.force_authenticate(self.student_b)
        self.assertTrue(self.client.get("/api/program-status/").data["is_active"])
        self.assertFalse(self._archived(self.thread_b))
        self.assertEqual(self._reply(self.thread_b).status_code, status.HTTP_201_CREATED)

    def test_cohort_is_open_on_its_last_day(self):
        Cohort.objects.filter(pk=self.cohort_a.pk).update(end_date=date.today())
        self.client.force_authenticate(self.student_a)
        self.assertTrue(self.client.get("/api/program-status/").data["is_active"])
        self.assertEqual(self._reply(self.thread_a).status_code, status.HTTP_201_CREATED)

    def test_admin_cannot_reply_in_ended_cohort_but_can_in_running_one(self):
        self._end(self.cohort_a)
        self.client.force_authenticate(self.admin)
        self.assertTrue(self.client.get("/api/program-status/").data["is_active"])
        self.assertTrue(self._archived(self.thread_a))
        self.assertEqual(self._reply(self.thread_a).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self._reply(self.thread_b).status_code, status.HTTP_201_CREATED)

    def test_admin_thread_never_lands_in_an_ended_cohort(self):
        # B started more recently but has ended; the new thread goes to A, which is still running.
        self._end(self.cohort_b)
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/forum/threads/", {"body": "Announcement"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(ForumThread.objects.get(pk=resp.data["id"]).cohort, self.cohort_a)
        self.assertFalse(resp.data["is_archived"])

    def test_admin_cannot_start_threads_once_every_cohort_has_ended(self):
        self._end(self.cohort_a)
        self._end(self.cohort_b)
        self.client.force_authenticate(self.admin)
        self.assertFalse(self.client.get("/api/program-status/").data["is_active"])
        resp = self.client.post("/api/forum/threads/", {"body": "Hello"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_thread_without_cohort_follows_the_repliers_cohort(self):
        legacy = self._thread(self.student_b, None)
        self._end(self.cohort_a)
        self.client.force_authenticate(self.student_a)
        self.assertFalse(self._archived(legacy))
        self.assertEqual(self._reply(legacy).status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.student_b)
        self.assertEqual(self._reply(legacy).status_code, status.HTTP_201_CREATED)

    def _not_started(self, cohort, days=3):
        Cohort.objects.filter(pk=cohort.pk).update(
            start_date=date.today() + timedelta(days=days), end_date=date.today() + timedelta(days=60),
        )
        cohort.refresh_from_db()

    def test_student_cannot_post_before_their_cohort_starts(self):
        self._not_started(self.cohort_a)
        legacy = self._thread(self.student_b, None)
        self.client.force_authenticate(self.student_a)
        status_data = self.client.get("/api/program-status/").data
        self.assertFalse(status_data["is_active"])
        self.assertEqual(status_data["opens_on"], self.cohort_a.start_date.isoformat())
        resp = self.client.post("/api/forum/threads/", {"body": "Hi all"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self._reply(self.thread_a).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self._reply(legacy).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self._listed_ids(), {self.thread_a.pk, legacy.pk})  # can still read

    def test_student_can_post_on_the_day_their_cohort_starts(self):
        Cohort.objects.filter(pk=self.cohort_a.pk).update(start_date=date.today())
        self.client.force_authenticate(self.student_a)
        status_data = self.client.get("/api/program-status/").data
        self.assertTrue(status_data["is_active"])
        self.assertIsNone(status_data["opens_on"])
        resp = self.client.post("/api/forum/threads/", {"body": "Hi all"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_ended_cohort_has_no_opens_on(self):
        self._end(self.cohort_a)
        self.client.force_authenticate(self.student_a)
        self.assertIsNone(self.client.get("/api/program-status/").data["opens_on"])

    def test_students_get_no_cohort_choices(self):
        self.client.force_authenticate(self.student_a)
        data = self.client.get("/api/program-status/").data
        self.assertEqual((data["thread_cohorts"], data["default_thread_cohort"]), ([], None))

    def test_admin_cohort_choices_skip_ended_and_default_to_latest_running(self):
        upcoming = Cohort.objects.create(
            name="C", year=2027, start_date=date.today() + timedelta(days=20), end_date=date.today() + timedelta(days=80),
        )
        ended = Cohort.objects.create(
            name="Old", year=2025, start_date=date.today() - timedelta(days=90), end_date=date.today() - timedelta(days=1),
        )
        self.client.force_authenticate(self.admin)
        data = self.client.get("/api/program-status/").data
        ids = [c["id"] for c in data["thread_cohorts"]]
        self.assertEqual(set(ids), {self.cohort_a.pk, self.cohort_b.pk, upcoming.pk})
        self.assertNotIn(ended.pk, ids)
        self.assertEqual(data["default_thread_cohort"], self.cohort_b.pk)

    def test_admin_can_post_to_a_chosen_cohort(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/forum/threads/", {"body": "For A", "cohort": self.cohort_a.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        thread_id = resp.data["id"]
        self.assertEqual(ForumThread.objects.get(pk=thread_id).cohort, self.cohort_a)
        self.client.force_authenticate(self.student_a)
        self.assertIn(thread_id, self._listed_ids())
        self.client.force_authenticate(self.student_b)
        self.assertNotIn(thread_id, self._listed_ids())

    def test_admin_can_welcome_an_upcoming_cohort_but_students_reply_only_once_it_starts(self):
        self._not_started(self.cohort_a)
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/forum/threads/", {"body": "Welcome", "cohort": self.cohort_a.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        welcome = ForumThread.objects.get(pk=resp.data["id"])
        self.client.force_authenticate(self.student_a)
        self.assertIn(welcome.pk, self._listed_ids())
        self.assertEqual(self._reply(welcome).status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_with_only_an_upcoming_cohort_defaults_to_it(self):
        self._end(self.cohort_b)
        self._not_started(self.cohort_a)
        self.client.force_authenticate(self.admin)
        data = self.client.get("/api/program-status/").data
        self.assertTrue(data["is_active"])
        self.assertEqual(data["default_thread_cohort"], self.cohort_a.pk)
        resp = self.client.post("/api/forum/threads/", {"body": "Welcome"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(ForumThread.objects.get(pk=resp.data["id"]).cohort, self.cohort_a)

    def test_admin_cannot_post_to_an_ended_cohort(self):
        self._end(self.cohort_a)
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/forum/threads/", {"body": "Late", "cohort": self.cohort_a.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cohort", resp.data)

    def test_admin_bad_cohort_values_are_rejected(self):
        self.client.force_authenticate(self.admin)
        for value in (999999, "abc", None):
            resp = self.client.post("/api/forum/threads/", {"body": "x", "cohort": value}, format="json")
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, value)
        self.assertFalse(ForumThread.objects.filter(created_by=self.admin).exists())

    def test_student_cannot_choose_a_cohort(self):
        self.client.force_authenticate(self.student_a)
        for cohort in (self.cohort_b, self.cohort_a):
            resp = self.client.post("/api/forum/threads/", {"body": "x", "cohort": cohort.pk}, format="json")
            self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(ForumThread.objects.filter(created_by=self.student_a).exclude(pk=self.thread_a.pk).exists())

    def _edit_post(self, post, body="edited"):
        return self.client.patch(f"/api/forum/posts/{post.pk}/", {"body": body}, format="json")

    def test_student_cannot_edit_after_cohort_ends(self):
        reply = ForumPost.objects.create(thread=self.thread_a, author=self.student_a, body="reply")
        self._end(self.cohort_a)
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._edit_post(reply).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self._edit_post(self.thread_a.opened_by).status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.patch(f"/api/forum/threads/{self.thread_a.pk}/", {"title": "New"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        reply.refresh_from_db()
        self.thread_a.refresh_from_db()
        self.assertEqual((reply.body, self.thread_a.title), ("reply", "T"))

    def test_student_can_still_delete_own_content_after_cohort_ends(self):
        reply = ForumPost.objects.create(thread=self.thread_a, author=self.student_a, body="reply")
        self._end(self.cohort_a)
        self.client.force_authenticate(self.student_a)
        resp = self.client.delete(f"/api/forum/posts/{reply.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        resp = self.client.delete(f"/api/forum/threads/{self.thread_a.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

    def test_student_can_edit_while_cohort_runs(self):
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._edit_post(self.thread_a.opened_by).status_code, status.HTTP_200_OK)

    def test_admin_can_still_edit_and_pin_in_ended_cohort(self):
        reply = ForumPost.objects.create(thread=self.thread_a, author=self.student_a, body="reply")
        self._end(self.cohort_a)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self._edit_post(reply, "moderated").status_code, status.HTTP_200_OK)
        resp = self.client.patch(f"/api/forum/threads/{self.thread_a.pk}/", {"is_pinned": True}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_edit_in_thread_without_cohort_follows_editors_cohort(self):
        legacy = self._thread(self.student_a, None)
        self._end(self.cohort_a)
        self.client.force_authenticate(self.student_a)
        self.assertEqual(self._edit_post(legacy.opened_by).status_code, status.HTTP_403_FORBIDDEN)

    def test_banned_check_still_comes_first(self):
        # A banned student in an ended cohort keeps getting the ban message, not the read-only one.
        self._end(self.cohort_a)
        User.objects.filter(pk=self.student_a.pk).update(forum_banned_at=timezone.now())
        self.student_a.refresh_from_db()
        self.client.force_authenticate(self.student_a)
        resp = self._edit_post(self.thread_a.opened_by)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("banned", str(resp.data).lower())

    def test_admins_see_each_threads_cohort_and_students_do_not(self):
        self.client.force_authenticate(self.admin)
        names = {t["id"]: t["cohort_name"] for t in self.client.get("/api/forum/threads/").data["results"]}
        self.assertEqual(names, {self.thread_a.pk: f"A ({self.cohort_a.year})",
                                 self.thread_b.pk: f"B ({self.cohort_b.year})"})
        detail = self.client.get(f"/api/forum/threads/{self.thread_a.pk}/").data
        self.assertEqual(detail["cohort_name"], f"A ({self.cohort_a.year})")
        self.client.force_authenticate(self.student_a)
        listed = self.client.get("/api/forum/threads/").data["results"]
        self.assertEqual([t["cohort_name"] for t in listed], [None])

    def test_moderation_and_user_overview_show_the_cohort(self):
        from ..models import ForumFlag
        reply = ForumPost.objects.create(thread=self.thread_b, author=self.student_b, body="rude")
        ForumFlag.objects.create(post=reply, flagged_by=self.student_a, reason="x")
        self.client.force_authenticate(self.admin)
        reported = self.client.get("/api/forum/posts/reported/").data["results"]
        self.assertEqual([p["cohort_name"] for p in reported], [f"B ({self.cohort_b.year})"])
        overview = self.client.get(f"/api/users/{self.student_b.pk}/overview/").data
        self.assertEqual({p["cohort_name"] for p in overview["forum"]["recent_posts"]}, {f"B ({self.cohort_b.year})"})

    def test_django_admin_thread_list_filters_by_cohort(self):
        from django.urls import reverse
        superuser = User.objects.create_superuser(email="su@test.local", password="pw")
        self.client.force_login(superuser)
        resp = self.client.get(reverse("admin:app_forumthread_changelist"), {"cohort__id__exact": self.cohort_a.pk})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(list(resp.context["cl"].result_list), [self.thread_a])

    def test_thread_list_does_not_query_per_thread_for_is_archived(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        self.client.force_authenticate(self.admin)
        self.client.get("/api/forum/threads/")
        with CaptureQueriesContext(connection) as few:
            self.client.get("/api/forum/threads/")
        for _ in range(5):
            self._thread(self.student_a, self.cohort_a)
        with CaptureQueriesContext(connection) as many:
            self.client.get("/api/forum/threads/")
        self.assertEqual(len(few), len(many))


class ForumThreadCohortMigrationTests(APITestCase):
    def test_backfill_uses_authors_cohort_then_running_cohort(self):
        import importlib
        from django.apps import apps as django_apps
        migration = importlib.import_module("app.migrations.0031_forumthread_cohort")
        today = date.today()
        old = Cohort.objects.create(
            name="Old", year=2025, start_date=today - timedelta(days=400), end_date=today - timedelta(days=300),
        )
        current = Cohort.objects.create(
            name="Now", year=today.year, start_date=today - timedelta(days=5), end_date=today + timedelta(days=50),
        )
        student = User.objects.create_user(email="s@test.local", password="pw")
        Enrollment.objects.create(user=student, cohort=old, status=Enrollment.Status.COMPLETED)
        admin = User.objects.create_user(email="ad@test.local", password="pw", role=User.Role.ADMIN)
        by_student = ForumThread.objects.create(created_by=student, title="S")
        by_admin = ForumThread.objects.create(created_by=admin, title="A")
        by_deleted = ForumThread.objects.create(created_by=None, title="D")

        migration.backfill_thread_cohorts(django_apps, None)

        for thread, expected in ((by_student, old), (by_admin, current), (by_deleted, current)):
            thread.refresh_from_db()
            self.assertEqual(thread.cohort, expected)

    def _backfill(self):
        import importlib
        from django.apps import apps as django_apps
        importlib.import_module("app.migrations.0031_forumthread_cohort").backfill_thread_cohorts(django_apps, None)

    def _cohort(self, name, start_offset, end_offset):
        today = date.today()
        return Cohort.objects.create(
            name=name, year=today.year,
            start_date=today + timedelta(days=start_offset), end_date=today + timedelta(days=end_offset),
        )

    def test_prefers_cohort_author_was_in_on_the_day_over_newer_one(self):
        posted_in = self._cohort("Then", -100, -40)
        newer = self._cohort("Now", -10, 50)
        student = User.objects.create_user(email="s@test.local", password="pw")
        Enrollment.objects.create(user=student, cohort=posted_in, status=Enrollment.Status.COMPLETED)
        Enrollment.objects.create(user=student, cohort=newer, status=Enrollment.Status.ACTIVE)
        thread = ForumThread.objects.create(created_by=student, title="T")
        ForumThread.objects.filter(pk=thread.pk).update(created_at=timezone.now() - timedelta(days=60))
        self._backfill()
        thread.refresh_from_db()
        self.assertEqual(thread.cohort, posted_in)

    def test_withdrawn_student_keeps_their_cohort(self):
        theirs = self._cohort("Theirs", -100, -40)
        self._cohort("Running", -5, 50)
        student = User.objects.create_user(email="w@test.local", password="pw")
        Enrollment.objects.create(user=student, cohort=theirs, status=Enrollment.Status.WITHDRAWN)
        thread = ForumThread.objects.create(created_by=student, title="T")
        self._backfill()
        thread.refresh_from_db()
        self.assertEqual(thread.cohort, theirs)

    def test_admin_with_an_enrollment_still_uses_running_cohort(self):
        enrolled = self._cohort("Enrolled", -100, -40)
        running = self._cohort("Running", -5, 50)
        admin = User.objects.create_user(email="ad@test.local", password="pw", role=User.Role.ADMIN)
        Enrollment.objects.create(user=admin, cohort=enrolled, status=Enrollment.Status.ACTIVE)
        thread = ForumThread.objects.create(created_by=admin, title="A")
        self._backfill()
        thread.refresh_from_db()
        self.assertEqual(thread.cohort, running)

    def test_pending_enrollment_is_ignored_and_no_match_stays_empty(self):
        future = self._cohort("Future", 10, 60)
        student = User.objects.create_user(email="p@test.local", password="pw")
        Enrollment.objects.create(user=student, cohort=future, status=Enrollment.Status.PENDING)
        thread = ForumThread.objects.create(created_by=student, title="T")
        self._backfill()
        thread.refresh_from_db()
        self.assertIsNone(thread.cohort)

    def test_threads_already_in_a_cohort_are_left_alone(self):
        chosen = self._cohort("Chosen", -100, -40)
        self._cohort("Running", -5, 50)
        thread = ForumThread.objects.create(created_by=None, title="T", cohort=chosen)
        self._backfill()
        thread.refresh_from_db()
        self.assertEqual(thread.cohort, chosen)

    def test_uses_perth_date_not_utc_date(self):
        # 23:30 UTC on the 1st is the 2nd in Perth, when only the second cohort was running.
        from datetime import datetime, timezone as dt_tz
        first = Cohort.objects.create(name="1st", year=2026, start_date=date(2026, 3, 1), end_date=date(2026, 3, 1))
        second = Cohort.objects.create(name="2nd", year=2026, start_date=date(2026, 3, 2), end_date=date(2026, 3, 2))
        thread = ForumThread.objects.create(created_by=None, title="T")
        ForumThread.objects.filter(pk=thread.pk).update(created_at=datetime(2026, 3, 1, 23, 30, tzinfo=dt_tz.utc))
        self._backfill()
        thread.refresh_from_db()
        self.assertEqual(thread.cohort, second)
        self.assertNotEqual(thread.cohort, first)
