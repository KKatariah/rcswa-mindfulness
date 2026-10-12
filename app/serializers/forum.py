"""Forum threads and posts."""


from django.conf import settings
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from ..access import (
    can_edit_forum_item,
    cohort_has_ended,
    is_admin,
    visible_forum_threads,
)
from ..models import (
    ForumFlag,
    ForumPost,
    ForumRulesRevision,
    ForumThread,
)
from ..utils import gravatar_url


def _forum_author_name(author, request):
    """
    Resolve the public name for a forum author.
    - Null author (deleted account) → "Deleted user".
    - Admin/staff viewer → "display_name (full_name)" if a display_name is set,
      otherwise just full_name.
    - Everyone else → display_name if set, else full_name.
    """
    if author is None:
        return "Deleted user"
    if request and is_admin(request.user):
        if author.display_name:
            return f"{author.display_name} ({author.full_name})"
        return author.full_name
    return author.display_name or author.full_name


class _ForumAuthorFieldsMixin(serializers.Serializer):
    """Author name/avatar and can_edit for a thread or post; author_attr names the author field.

    Authors' email addresses are never included: display names exist so students aren't identified."""

    author_attr = "author"

    author_name = serializers.SerializerMethodField()
    author_avatar_url = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    is_own = serializers.SerializerMethodField()

    def _author(self, obj):
        return getattr(obj, self.author_attr)

    def get_author_name(self, obj):
        return _forum_author_name(self._author(obj), self.context.get("request"))

    def get_author_avatar_url(self, obj):
        author = self._author(obj)
        return gravatar_url(author.email if author else "")

    def get_can_edit(self, obj):
        request = self.context.get("request")
        return bool(request) and can_edit_forum_item(request.user, obj)

    def get_is_own(self, obj):
        """Whether the viewer wrote it (can_edit is also true for admins, so it can't stand in)."""
        request = self.context.get("request")
        author_id = getattr(obj, f"{self.author_attr}_id")
        return bool(request) and author_id is not None and author_id == request.user.pk


# Longest forum post or reply, in characters (the client's textareas use the same cap).
FORUM_POST_MAX_CHARS = 5000


def _cohort_label(cohort):
    return f"{cohort.name} ({cohort.year})" if cohort else None


def _request_is_admin(serializer):
    request = serializer.context.get("request")
    return bool(request) and is_admin(request.user)


class ForumPostCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ForumPost
        fields = ["id", "thread", "parent_post", "body"]
        extra_kwargs = {"body": {"max_length": FORUM_POST_MAX_CHARS}}

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request is not None:
            # Another cohort's thread or post gets the same "does not exist" error as a missing one.
            visible = visible_forum_threads(ForumThread.objects.all(), request.user)
            fields["thread"].queryset = visible
            fields["parent_post"].queryset = ForumPost.objects.filter(thread__in=visible)
        return fields

    def validate(self, attrs):
        if ForumPost.objects.filter(thread=attrs["thread"], is_head_post=True, is_deleted=True).exists():
            raise serializers.ValidationError({"thread": "This thread has been removed."})
        parent = attrs.get("parent_post")
        if parent is not None and parent.thread_id != attrs["thread"].pk:
            raise serializers.ValidationError({"parent_post": "A reply must be to a post in the same thread."})
        return attrs


class ForumPostSerializer(_ForumAuthorFieldsMixin, serializers.ModelSerializer):
    is_thread_author = serializers.SerializerMethodField()
    has_flagged = serializers.SerializerMethodField()

    class Meta:
        model = ForumPost
        fields = [
            "id", "thread", "parent_post",
            "author_name", "author_avatar_url",
            "body", "created_at", "updated_at", "edited_at", "can_edit",
            "is_own", "is_thread_author", "has_flagged",
        ]
        read_only_fields = ["thread", "parent_post", "created_at", "updated_at", "edited_at"]
        extra_kwargs = {"body": {"max_length": FORUM_POST_MAX_CHARS}}

    def update(self, instance, validated_data):
        instance.body = validated_data.get("body", instance.body)
        instance.edited_at = timezone.now()
        instance.save()
        return instance

    def get_is_thread_author(self, obj):
        return obj.author_id is not None and obj.author_id == obj.thread.created_by_id

    def get_has_flagged(self, obj):
        """Whether the viewer has an open report on it (annotated by ForumThreadViewSet)."""
        return bool(getattr(obj, "flagged_by_me", False))


def _thread_posts(thread):
    """The thread's posts, opening post first. Sorted once and kept on the thread for this request."""
    if not hasattr(thread, "_sorted_posts"):
        thread._sorted_posts = sorted(thread.posts.all(), key=lambda p: (p.created_at, p.pk))
    return thread._sorted_posts


class ForumThreadSerializer(_ForumAuthorFieldsMixin, serializers.ModelSerializer):
    author_attr = "created_by"

    body = serializers.SerializerMethodField()
    reply_count = serializers.SerializerMethodField()
    edited_at = serializers.SerializerMethodField()
    can_pin = serializers.SerializerMethodField()
    is_archived = serializers.SerializerMethodField()
    cohort_name = serializers.SerializerMethodField()

    class Meta:
        model = ForumThread
        fields = [
            "id", "title", "module", "content_item",
            "author_name", "author_avatar_url",
            "created_at", "updated_at", "edited_at",
            "body", "reply_count", "can_edit", "is_own", "is_pinned", "pin_order", "can_pin",
            "is_archived", "cohort_name",
        ]
        read_only_fields = ["module", "content_item", "created_at", "updated_at", "edited_at", "pin_order"]

    def get_body(self, obj):
        posts = _thread_posts(obj)
        return posts[0].body if posts else ""

    def get_reply_count(self, obj):
        active = [p for p in obj.posts.all() if not p.is_deleted]
        return max(0, len(active) - 1)

    def get_edited_at(self, obj):
        posts = _thread_posts(obj)
        return posts[0].edited_at if posts else None

    def get_can_pin(self, obj):
        return _request_is_admin(self)

    def get_cohort_name(self, obj):
        """Which cohort the thread belongs to, for admins (who see every cohort); null for students."""
        return _cohort_label(obj.cohort) if _request_is_admin(self) else None

    def get_is_archived(self, obj):
        """True once the thread's cohort has ended: it can be read but not replied to."""
        return obj.cohort is not None and cohort_has_ended(obj.cohort)

    def validate(self, attrs):
        if "is_pinned" in attrs and not _request_is_admin(self):
            raise PermissionDenied("Only admins can pin or unpin threads.")

        is_pinning = attrs.get("is_pinned")
        if is_pinning is True:
            instance = getattr(self, "instance", None)
            if instance is None or not instance.is_pinned:
                max_pinned = settings.FORUM_MAX_PINNED_THREADS
                cohort_id = getattr(instance, "cohort_id", None)
                current = ForumThread.pinned_in_cohort(cohort_id).exclude(pk=getattr(instance, "pk", None)).count()
                if current >= max_pinned:
                    raise serializers.ValidationError(
                        {"is_pinned": f"You have already reached the maximum of {max_pinned} pinned threads."}
                    )
        return attrs


class ForumThreadDetailSerializer(ForumThreadSerializer):
    replies = serializers.SerializerMethodField()
    opening_post = serializers.SerializerMethodField()

    class Meta(ForumThreadSerializer.Meta):
        fields = ForumThreadSerializer.Meta.fields + ["opening_post", "replies"]

    def get_opening_post(self, obj):
        posts = _thread_posts(obj)
        return ForumPostSerializer(posts[0], context=self.context).data if posts else None

    def get_replies(self, obj):
        replies = [p for p in _thread_posts(obj)[1:] if not p.is_deleted]
        return ForumPostSerializer(replies, many=True, context=self.context).data


class ForumThreadCreateSerializer(serializers.ModelSerializer):
    # title is derived from the body on the server; not accepted from the client.
    body = serializers.CharField(max_length=FORUM_POST_MAX_CHARS)

    class Meta:
        model = ForumThread
        # cohort: admins choose which cohort sees the thread; students always post to their own.
        fields = ["body", "module", "content_item", "cohort"]
        extra_kwargs = {"cohort": {"required": False, "allow_null": False}}

    def validate(self, data):
        if data.get("module") and data.get("content_item"):
            raise serializers.ValidationError(
                "Provide either 'module' or 'content_item', not both."
            )
        cohort = data.get("cohort")
        if cohort is not None:
            if not _request_is_admin(self):
                raise PermissionDenied("Only admins can choose a cohort.")
            if cohort_has_ended(cohort):
                raise serializers.ValidationError({"cohort": "This cohort has ended, so its forum is read-only."})
        return data


# ── Moderation (admin only) ────────────────────────────────────────────────────

class ForumFlagCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class _ModeratedAuthorSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    full_name = serializers.CharField()
    display_name = serializers.CharField()
    email = serializers.EmailField()
    forum_banned = serializers.BooleanField(source="is_forum_banned")
    forum_banned_until = serializers.DateTimeField()


class ModeratedPostSerializer(serializers.ModelSerializer):
    """A post as the moderation pages show it, with its thread and its author's ban status."""

    thread_title = serializers.CharField(source="thread.title")
    cohort_name = serializers.SerializerMethodField()
    author = _ModeratedAuthorSerializer(allow_null=True)
    deleted_by_name = serializers.SerializerMethodField()
    removed_by_author = serializers.SerializerMethodField()

    class Meta:
        model = ForumPost
        fields = [
            "id", "thread", "thread_title", "cohort_name", "is_head_post", "body", "created_at", "edited_at",
            "author", "is_deleted", "deleted_at", "deleted_by_name", "removed_by_author",
        ]

    def get_cohort_name(self, obj):
        return _cohort_label(obj.thread.cohort)

    def get_deleted_by_name(self, obj):
        if not obj.is_deleted or obj.deleted_by is None:
            return None
        return obj.deleted_by.full_name or obj.deleted_by.email

    def get_removed_by_author(self, obj):
        """True when the author deleted it themselves; null if it isn't deleted or nobody is recorded."""
        if not obj.is_deleted or obj.deleted_by_id is None:
            return None
        return obj.deleted_by_id == obj.author_id


class _OpenFlagSerializer(serializers.ModelSerializer):
    flagged_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ForumFlag
        fields = ["id", "reason", "created_at", "flagged_by_name"]

    def get_flagged_by_name(self, obj):
        user = obj.flagged_by
        if user is None:
            return "Deleted user"
        return user.full_name or user.email


class ReportedPostSerializer(ModeratedPostSerializer):
    """A post with open reports; `open_flags` is prefetched by the view, newest first."""

    flags = _OpenFlagSerializer(source="open_flags", many=True)

    class Meta(ModeratedPostSerializer.Meta):
        fields = ModeratedPostSerializer.Meta.fields + ["flags"]


FORUM_RULES_MAX = 20
FORUM_RULE_TITLE_MAX_CHARS = 120
FORUM_RULE_BODY_MAX_CHARS = 500


class ForumRuleSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=FORUM_RULE_TITLE_MAX_CHARS)
    body = serializers.CharField(max_length=FORUM_RULE_BODY_MAX_CHARS, allow_blank=True, required=False, default="")


class ForumRulesSerializer(serializers.ModelSerializer):
    """The current rules for everyone; admins save a new version through it."""

    rules = ForumRuleSerializer(many=True)
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ForumRulesRevision
        fields = ["id", "rules", "created_at", "updated_by_name", "requires_reaccept"]
        read_only_fields = ["id", "created_at"]
        extra_kwargs = {"requires_reaccept": {"write_only": True}}

    def get_updated_by_name(self, obj):
        # Only admins see who last changed the rules.
        if not is_admin(self.context["request"].user):
            return None
        return str(obj.created_by) if obj.created_by else None

    def validate_rules(self, rules):
        if not rules:
            raise serializers.ValidationError("Add at least one rule.")
        if len(rules) > FORUM_RULES_MAX:
            raise serializers.ValidationError(f"There can be at most {FORUM_RULES_MAX} rules.")
        return [{"title": r["title"].strip(), "body": r.get("body", "").strip()} for r in rules]
