from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from .models import (
    ContentCompletion,
    ContentItem,
    Module,
    NotificationPreference,
    PushSubscription,
    ContentView,
    ForumPost,
    ForumThread,
    Resource,
    Survey,
    SurveyResponse,
    User,
)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["email", "full_name", "password"]

    def create(self, validated_data):
        return User.objects.create_user(
            email=validated_data["email"],
            full_name=validated_data["full_name"],
            password=validated_data["password"],
        )


class ResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = ["id", "title", "url", "resource_type", "display_order"]


class ContentItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentItem
        fields = ["id", "title", "type", "provider", "embed_url", "display_order"]


class ModuleSerializer(serializers.ModelSerializer):
    is_unlocked = serializers.SerializerMethodField()

    def get_is_unlocked(self, obj):
        return obj.unlock_at is None or obj.unlock_at <= timezone.now()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self.get_is_unlocked(instance):
            data["content_items"] = []
            data["resources"] = []
        return data

    # related_name="content_items" and related_name="resources" on the FK definitions
    content_items = ContentItemSerializer(many=True, read_only=True)
    resources = ResourceSerializer(many=True, read_only=True)

    class Meta:
        model = Module
        fields = [
            "id",
            "week_number",
            "unlock_at",
            "is_unlocked",
            "title",
            "description",
            "content_items",
            "resources",
        ]


class ModuleSummarySerializer(serializers.ModelSerializer):
    """Public-safe module summary (short blurb only, no full content) for marketing pages."""

    class Meta:
        model = Module
        fields = ["id", "week_number", "title", "summary"]


class ContentCompletionSerializer(serializers.ModelSerializer):
    def validate_content_item(self, item):
        module = item.module
        if not module.is_published or (module.unlock_at and module.unlock_at > timezone.now()):
            raise serializers.ValidationError("This module is not available yet.")
        return item

    # read_only=True: user is injected by the viewset, never accepted from the payload.
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = ContentCompletion
        fields = ["id", "user", "content_item", "completed_at"]
        read_only_fields = ["completed_at"]


class ContentViewSerializer(serializers.ModelSerializer):
    # read_only=True: user is injected by the viewset, never accepted from the payload.
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = ContentView
        fields = ["id", "user", "module", "viewed_at"]
        read_only_fields = ["viewed_at"]


# ── Forum ──────────────────────────────────────────────────────────────────────────────

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
    if request and request.user.is_authenticated:
        u = request.user
        if getattr(u, "role", None) == "admin" or u.is_staff:
            if author.display_name:
                return f"{author.display_name} ({author.full_name})"
            return author.full_name
    return author.display_name or author.full_name


def _can_edit(obj, request):
    """True if the requesting user authored obj or has admin/staff rights."""
    if not request or not request.user.is_authenticated:
        return False
    u = request.user
    if getattr(u, "role", None) == "admin" or u.is_staff:
        return True
    if isinstance(obj, ForumThread):
        return obj.created_by_id == u.pk
    return obj.author_id == u.pk


class ForumPostCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ForumPost
        fields = ["id", "thread", "parent_post", "body"]


class ForumPostSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_email = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = ForumPost
        fields = [
            "id", "thread", "parent_post",
            "author_name", "author_email",
            "body", "created_at", "updated_at", "can_edit",
        ]
        read_only_fields = ["thread", "parent_post", "created_at", "updated_at"]

    def get_author_name(self, obj):
        return _forum_author_name(obj.author, self.context.get("request"))

    def get_author_email(self, obj):
        return getattr(obj.author, "email", None)

    def get_can_edit(self, obj):
        return _can_edit(obj, self.context.get("request"))

    def update(self, instance, validated_data):
        instance.body = validated_data.get("body", instance.body)
        instance.save()
        return instance


def _is_admin(request):
    if not request or not request.user.is_authenticated:
        return False
    u = request.user
    return getattr(u, "role", None) == "admin" or u.is_staff


class ForumThreadSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_email = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    reply_count = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_pin = serializers.SerializerMethodField()

    class Meta:
        model = ForumThread
        fields = [
            "id", "title", "module", "content_item",
            "author_name", "author_email", "created_at", "updated_at",
            "body", "reply_count", "can_edit", "is_pinned", "can_pin",
        ]
        read_only_fields = ["module", "content_item", "created_at", "updated_at"]

    def get_author_name(self, obj):
        return _forum_author_name(obj.created_by, self.context.get("request"))

    def get_author_email(self, obj):
        return getattr(obj.created_by, "email", None)

    def get_body(self, obj):
        posts = sorted(obj.posts.all(), key=lambda p: (p.created_at, p.pk))
        return posts[0].body if posts else ""

    def get_reply_count(self, obj):
        active = [p for p in obj.posts.all() if not p.is_deleted]
        return max(0, len(active) - 1)

    def get_can_edit(self, obj):
        return _can_edit(obj, self.context.get("request"))

    def get_can_pin(self, obj):
        return _is_admin(self.context.get("request"))

    def validate(self, attrs):
        if "is_pinned" in attrs and not _is_admin(self.context.get("request")):
            raise PermissionDenied("Only admins can pin or unpin threads.")
        return attrs


class ForumThreadDetailSerializer(ForumThreadSerializer):
    replies = serializers.SerializerMethodField()
    opening_post = serializers.SerializerMethodField()

    class Meta(ForumThreadSerializer.Meta):
        fields = ForumThreadSerializer.Meta.fields + ["opening_post", "replies"]

    def get_opening_post(self, obj):
        posts = sorted(obj.posts.all(), key=lambda p: (p.created_at, p.pk))
        if not posts:
            return None
        return ForumPostSerializer(posts[0], context=self.context).data

    def get_replies(self, obj):
        posts = sorted(obj.posts.all(), key=lambda p: (p.created_at, p.pk))
        first_id = posts[0].pk if posts else None
        replies = [p for p in posts if p.pk != first_id and not p.is_deleted]
        return ForumPostSerializer(replies, many=True, context=self.context).data


class ForumThreadCreateSerializer(serializers.ModelSerializer):
    # title is derived from the body on the server; not accepted from the client.
    body = serializers.CharField()

    class Meta:
        model = ForumThread
        fields = ["body", "module", "content_item"]

    def validate(self, data):
        if data.get("module") and data.get("content_item"):
            raise serializers.ValidationError(
                "Provide either 'module' or 'content_item', not both."
            )
        return data


# ── User profile ───────────────────────────────────────────────────────────────

class UserDisplayNameSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "display_name"]
        read_only_fields = ["id"]


# ── Surveys ────────────────────────────────────────────────────────────────────

def _survey_is_unlocked(survey, user):
    """Return True if every ContentItem in the survey's module is completed by user."""
    if survey.module_id is None:
        # Weekly surveys always require a module; guard against misconfigured data.
        if survey.type == Survey.SurveyType.WEEKLY:
            return False
        return True
    if not survey.module.is_published or (survey.module.unlock_at and survey.module.unlock_at > timezone.now()):
        return False
    required_ids = set(
        ContentItem.objects.filter(module_id=survey.module_id).values_list("id", flat=True)
    )
    if not required_ids:
        return True
    completed_ids = set(
        ContentCompletion.objects.filter(user=user, content_item_id__in=required_ids)
        .values_list("content_item_id", flat=True)
    )
    return required_ids == completed_ids


def _validate_survey_answers(questions, answers):
    """
    Validate a dict of answers against the survey question definitions.
    Returns a list of error strings; empty means valid.
    """
    errors = []
    question_map = {q["id"]: q for q in questions}

    for ans_id in answers:
        if ans_id not in question_map:
            errors.append(f"Unknown question id: {ans_id!r}.")
    if errors:
        return errors

    # A question is skipped if its skip_if condition is met.
    skipped = set()
    for q in questions:
        skip_if = q.get("skip_if")
        if skip_if and answers.get(skip_if["question_id"]) == skip_if["value"]:
            skipped.add(q["id"])

    for q in questions:
        qid = q["id"]
        if qid in skipped:
            continue
        if qid not in answers:
            errors.append(f"Question {qid!r} is required.")
            continue
        val = answers[qid]
        qtype = q["type"]
        if qtype == "integer":
            if not isinstance(val, int) or isinstance(val, bool) or val < 0:
                errors.append(f"Question {qid!r}: expected a non-negative integer.")
        elif qtype == "likert":
            lo, hi = q["min"], q["max"]
            if not isinstance(val, int) or isinstance(val, bool) or not (lo <= val <= hi):
                errors.append(f"Question {qid!r}: expected an integer between {lo} and {hi}.")
        elif qtype == "longtext":
            if not isinstance(val, str) or not val.strip():
                errors.append(f"Question {qid!r}: expected a non-empty string.")

    return errors


class SurveySerializer(serializers.ModelSerializer):
    is_unlocked = serializers.SerializerMethodField()
    has_responded = serializers.SerializerMethodField()

    class Meta:
        model = Survey
        fields = ["id", "code", "title", "type", "module", "is_unlocked", "has_responded"]

    def get_is_unlocked(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        completed_ids = self.context.get("completed_ids")
        if completed_ids is not None:
            if obj.module_id is None:
                if obj.type == Survey.SurveyType.WEEKLY:
                    return False
                return True
            if not obj.module.is_published or (obj.module.unlock_at and obj.module.unlock_at > timezone.now()):
                return False
            required_ids = {ci.id for ci in obj.module.content_items.all()}
            return not required_ids or required_ids <= completed_ids
        return _survey_is_unlocked(obj, request.user)

    def get_has_responded(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        return SurveyResponse.objects.filter(user=request.user, survey=obj).exists()


class SurveyDetailSerializer(SurveySerializer):
    class Meta(SurveySerializer.Meta):
        fields = SurveySerializer.Meta.fields + ["questions"]


class SurveyResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = SurveyResponse
        fields = ["id", "survey", "answers", "submitted_at"]
        read_only_fields = ["submitted_at"]

    def validate(self, attrs):
        survey = attrs.get("survey", self.instance.survey if self.instance else None)
        answers = attrs.get("answers")
        if answers is not None and survey is not None:
            if not isinstance(answers, dict):
                raise serializers.ValidationError({"answers": ["answers must be a JSON object."]})
            errors = _validate_survey_answers(survey.questions, answers)
            if errors:
                raise serializers.ValidationError({"answers": errors})
        return attrs


class SurveyResponseUpdateSerializer(SurveyResponseSerializer):
    class Meta(SurveyResponseSerializer.Meta):
        read_only_fields = list(SurveyResponseSerializer.Meta.read_only_fields) + ["survey"]


class SurveyResponseAdminSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    survey_title = serializers.SerializerMethodField()

    class Meta:
        model = SurveyResponse
        fields = ["id", "survey", "survey_title", "student_name", "answers", "submitted_at"]

    def get_student_name(self, obj):
        return obj.user.full_name if obj.user else "Deleted user"

    def get_survey_title(self, obj):
        return obj.survey.title if obj.survey else ""


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["display_name"]


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)


# ── Push notifications ─────────────────────────────────────────────────────────

class PushSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushSubscription
        fields = ["id", "endpoint", "p256dh", "auth", "created_at", "last_seen"]
        read_only_fields = ["id", "created_at", "last_seen"]
        extra_kwargs = {
            "endpoint": {"validators": []},
        }


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = [
            "id",
            "email_enabled",
            "inapp_enabled",
            "reminder_time",
            "push_denied",
        ]
        read_only_fields = ["id"]
