import re

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Max
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from .access import (
    can_edit_forum_item,
    is_admin,
    module_is_unlocked,
    module_unlock_date,
    survey_is_unlocked,
)
from .utils import gravatar_url

from .models import (
    AdditionalResource,
    Cohort,
    ContentCompletion,
    ContentItem,
    ContentView,
    Enrollment,
    ForumPost,
    ForumThread,
    Module,
    NotificationPreference,
    PushSubscription,
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

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        # Run AUTH_PASSWORD_VALIDATORS; the unsaved user lets the similarity
        # check compare the password against the email and name.
        candidate = User(email=attrs.get("email", ""), full_name=attrs.get("full_name", ""))
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(
            email=validated_data["email"],
            full_name=validated_data["full_name"],
            password=validated_data["password"],
        )


# ── Cohorts & Enrollment ──────────────────────────────────────────────────────

class CohortSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cohort
        fields = ["id", "name", "year", "start_date", "end_date"]

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end <= start:
            raise serializers.ValidationError({"end_date": "end_date must be after start_date."})
        instance = self.instance
        if (
            instance
            and "start_date" in attrs
            and attrs["start_date"] != instance.start_date
            and instance.start_date <= timezone.localdate()
            and instance.enrollments.filter(status=Enrollment.Status.ACTIVE).exists()
        ):
            # Moving the start date would shift every member's unlock dates and
            # could re-lock weeks they have already opened.
            raise serializers.ValidationError(
                {"start_date": "This cohort has started and has active students, so its start date can't change."}
            )
        return attrs


class EnrollmentSerializer(serializers.ModelSerializer):
    user_email = serializers.SerializerMethodField()
    user_full_name = serializers.SerializerMethodField()

    class Meta:
        model = Enrollment
        fields = ["id", "user", "user_email", "user_full_name", "cohort", "status", "enrolled_at"]
        read_only_fields = ["enrolled_at"]

    def validate(self, attrs):
        # One active enrollment per user: unlock dates, reminders and notices all
        # assume a single cohort. Move a user by changing the cohort instead.
        user = attrs.get("user", getattr(self.instance, "user", None))
        new_status = attrs.get("status", getattr(self.instance, "status", Enrollment.Status.ACTIVE))
        if user and new_status == Enrollment.Status.ACTIVE:
            others = Enrollment.objects.filter(user=user, status=Enrollment.Status.ACTIVE)
            if self.instance:
                others = others.exclude(pk=self.instance.pk)
            if others.exists():
                raise serializers.ValidationError(
                    {"status": "This user is already active in another cohort. Move or withdraw that enrollment first."}
                )
        return attrs

    def get_user_email(self, obj):
        return obj.user.email if obj.user else None

    def get_user_full_name(self, obj):
        return obj.user.full_name if obj.user else None


class ResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = ["id", "title", "url", "resource_type", "display_order"]


# ── Additional Resources (public Resources page: books/documentaries/programs) ──

# Largest cover image an admin can upload.
COVER_IMAGE_MAX_BYTES = 5 * 1024 * 1024


class AdditionalResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdditionalResource
        fields = [
            "id",
            "category",
            "title",
            "author",
            "url",
            "cover_image",
            "display_order",
            "created_at",
            "updated_at",
        ]
        # Order is set by appending to the category and changed only via the reorder action,
        # so two resources can't be given the same slot.
        read_only_fields = ["id", "display_order", "created_at", "updated_at"]

    def validate_cover_image(self, image):
        if image and image.size > COVER_IMAGE_MAX_BYTES:
            raise serializers.ValidationError("Cover images must be 5 MB or smaller.")
        return image

    @staticmethod
    def _end_of(category):
        last = AdditionalResource.objects.filter(category=category).aggregate(Max("display_order"))
        return (last["display_order__max"] or 0) + 1

    def create(self, validated_data):
        validated_data["display_order"] = self._end_of(validated_data["category"])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        category = validated_data.get("category", instance.category)
        if category != instance.category:
            validated_data["display_order"] = self._end_of(category)
        return super().update(instance, validated_data)


class ContentItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentItem
        fields = ["id", "module", "title", "type", "provider", "embed_url", "display_order", "day_offset"]

    def validate_day_offset(self, value):
        # 0 = first day of the module's week; send_due_reminders only ever looks for 0-6.
        if value is not None and value > 6:
            raise serializers.ValidationError("Reminder day must be between 0 and 6.")
        return value

    def validate(self, attrs):
        provider = attrs.get("provider", getattr(self.instance, "provider", ""))
        embed_url = attrs.get("embed_url", getattr(self.instance, "embed_url", ""))
        if not provider:
            raise serializers.ValidationError({"provider": "Content items require a provider."})
        if not embed_url:
            raise serializers.ValidationError({"embed_url": "Content items require an embed_url."})
        return attrs

    def create(self, validated_data):
        # New items go to the end of their module unless a position is given.
        if "display_order" not in validated_data:
            last = validated_data["module"].content_items.order_by("-display_order").first()
            validated_data["display_order"] = last.display_order + 1 if last else 1
        return super().create(validated_data)


class ModuleSerializer(serializers.ModelSerializer):
    unlock_at = serializers.SerializerMethodField()
    is_unlocked = serializers.SerializerMethodField()

    def _user(self):
        request = self.context.get("request")
        return request.user if request else None

    def get_unlock_at(self, obj):
        user = self._user()
        unlock_date = module_unlock_date(obj, user) if user else None
        return unlock_date.isoformat() if unlock_date else None

    def get_is_unlocked(self, obj):
        user = self._user()
        return bool(user) and module_is_unlocked(obj, user)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not data["is_unlocked"]:
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
            "summary",
            "is_published",
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
        if not module_is_unlocked(item.module, self.context["request"].user):
            raise serializers.ValidationError("This module is not available yet.")
        return item

    # read_only=True: user is injected by the viewset, never accepted from the payload.
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = ContentCompletion
        fields = ["id", "user", "content_item", "completed_at"]
        read_only_fields = ["completed_at"]


class ContentViewSerializer(serializers.ModelSerializer):
    def validate_module(self, module):
        # Same rule as opening the module page: unpublished or locked modules can't be "viewed".
        if not module_is_unlocked(module, self.context["request"].user):
            raise serializers.ValidationError("This module is not available yet.")
        return module

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


# Longest forum post or reply, in characters (the client's textareas use the same cap).
FORUM_POST_MAX_CHARS = 5000


def _request_is_admin(serializer):
    request = serializer.context.get("request")
    return bool(request) and is_admin(request.user)


class ForumPostCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ForumPost
        fields = ["id", "thread", "parent_post", "body"]
        extra_kwargs = {"body": {"max_length": FORUM_POST_MAX_CHARS}}

    def validate(self, attrs):
        parent = attrs.get("parent_post")
        if parent is not None and parent.thread_id != attrs["thread"].pk:
            raise serializers.ValidationError({"parent_post": "A reply must be to a post in the same thread."})
        return attrs


class ForumPostSerializer(_ForumAuthorFieldsMixin, serializers.ModelSerializer):

    class Meta:
        model = ForumPost
        fields = [
            "id", "thread", "parent_post",
            "author_name", "author_avatar_url",
            "body", "created_at", "updated_at", "edited_at", "can_edit",
        ]
        read_only_fields = ["thread", "parent_post", "created_at", "updated_at", "edited_at"]
        extra_kwargs = {"body": {"max_length": FORUM_POST_MAX_CHARS}}

    def update(self, instance, validated_data):
        instance.body = validated_data.get("body", instance.body)
        instance.edited_at = timezone.now()
        instance.save()
        return instance


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

    class Meta:
        model = ForumThread
        fields = [
            "id", "title", "module", "content_item",
            "author_name", "author_avatar_url",
            "created_at", "updated_at", "edited_at",
            "body", "reply_count", "can_edit", "is_pinned", "pin_order", "can_pin",
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

    def validate(self, attrs):
        if "is_pinned" in attrs and not _request_is_admin(self):
            raise PermissionDenied("Only admins can pin or unpin threads.")

        is_pinning = attrs.get("is_pinned")
        if is_pinning is True:
            instance = getattr(self, "instance", None)
            if instance is None or not instance.is_pinned:
                max_pinned = settings.FORUM_MAX_PINNED_THREADS
                current = ForumThread.objects.filter(is_pinned=True).exclude(pk=getattr(instance, "pk", None)).count()
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


class AdminUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "full_name",
            "display_name",
            "role",
            "auth_provider",
            "is_staff",
            "created_at",
        ]
        read_only_fields = fields


class AdminUserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name", "display_name", "role"]
        read_only_fields = ["id"]

    def validate_role(self, value):
        # Stops admins locking everyone out of the admin portal by mistake.
        request = self.context.get("request")
        if not self.instance or value == User.Role.ADMIN or self.instance.role != User.Role.ADMIN:
            return value
        if request and self.instance.pk == request.user.pk:
            raise serializers.ValidationError("You can't remove your own admin role.")
        if not User.objects.filter(role=User.Role.ADMIN).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError("There must always be at least one admin.")
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exclude(pk=self.instance.pk if self.instance else None).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value


# ── Surveys ────────────────────────────────────────────────────────────────────

# Generous cap on free-text answers; the form asks for 100-250 words.
LONGTEXT_MAX_CHARS = 5000


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
            elif len(val) > LONGTEXT_MAX_CHARS:
                errors.append(f"Question {qid!r}: must be at most {LONGTEXT_MAX_CHARS} characters.")

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
        return survey_is_unlocked(
            obj,
            request.user,
            completed_ids=self.context.get("completed_ids"),
            responded_ids=self.context.get("responded_ids"),
        )

    def get_has_responded(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        responded_ids = self.context.get("responded_ids")
        if responded_ids is not None:
            return obj.pk in responded_ids
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


SURVEY_QUESTION_TYPES = ("integer", "likert", "longtext")
SURVEY_QUESTION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,30}$")
_SURVEY_QUESTION_KEYS = {"id", "type", "text", "section", "unit", "min", "max", "scale_labels", "skip_if"}
# Fields that only make sense for one question type.
_SURVEY_TYPE_ONLY_KEYS = {"unit": "integer", "min": "likert", "max": "likert", "scale_labels": "likert"}
SURVEY_MAX_QUESTIONS = 100
SURVEY_CODE_RE = re.compile(r"^[A-Za-z0-9_-]+$")
# Control characters other than tab/newline; Postgres also rejects NUL in JSON.
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# Changing these on a survey that already has responses would invalidate stored
# answers or shift CSV columns, so they're frozen once anyone has responded.
_SURVEY_STRUCTURE_KEYS = ("id", "type", "min", "max", "skip_if")


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def validate_survey_questions(questions):
    """Check a survey's question definitions; raise ValidationError listing every problem."""
    if not isinstance(questions, list) or not questions:
        raise serializers.ValidationError("A survey needs at least one question.")
    if len(questions) > SURVEY_MAX_QUESTIONS:
        raise serializers.ValidationError(f"A survey can have at most {SURVEY_MAX_QUESTIONS} questions.")
    errors = []
    seen = {}
    for i, q in enumerate(questions, start=1):
        if not isinstance(q, dict):
            errors.append(f"Question {i}: must be an object.")
            continue
        label = f"Question {q.get('id', i)!s}"
        unknown = set(q) - _SURVEY_QUESTION_KEYS
        if unknown:
            errors.append(f"{label}: unknown field(s) {', '.join(sorted(unknown))}.")
        qid = q.get("id")
        if not isinstance(qid, str) or not SURVEY_QUESTION_ID_RE.match(qid):
            errors.append(f"Question {i}: id must be 1-30 letters, digits, '-' or '_'.")
        elif qid in seen:
            errors.append(f"{label}: duplicate id.")
        if q.get("type") not in SURVEY_QUESTION_TYPES:
            errors.append(f"{label}: type must be one of {', '.join(SURVEY_QUESTION_TYPES)}.")
        misplaced = sorted(k for k, t in _SURVEY_TYPE_ONLY_KEYS.items() if k in q and q.get("type") != t)
        if misplaced:
            errors.append(f"{label}: {', '.join(misplaced)} not allowed on {q.get('type')} questions.")
        text = q.get("text")
        if not isinstance(text, str) or not text.strip():
            errors.append(f"{label}: text is required.")
        elif len(text) > 1000:
            errors.append(f"{label}: text must be at most 1000 characters.")
        for key in ("section", "unit"):
            if key in q and (not isinstance(q[key], str) or len(q[key]) > 1000):
                errors.append(f"{label}: {key} must be text of at most 1000 characters.")
        texts = [q.get(k) for k in ("text", "section", "unit")]
        if isinstance(q.get("scale_labels"), dict):
            texts += list(q["scale_labels"].values())
        if any(isinstance(t, str) and _CONTROL_CHARS_RE.search(t) for t in texts):
            errors.append(f"{label}: text contains invalid control characters.")
        if q.get("type") == "likert":
            lo, hi = q.get("min"), q.get("max")
            if not (_is_int(lo) and _is_int(hi) and lo < hi <= lo + 10):
                errors.append(f"{label}: likert questions need whole-number min < max, at most 10 apart.")
            labels = q.get("scale_labels", {})
            if not isinstance(labels, dict) or not all(
                isinstance(v, str) and k.lstrip("-").isdigit() for k, v in labels.items()
            ):
                errors.append(f"{label}: scale_labels must map scale values to text.")
        skip_if = q.get("skip_if")
        if skip_if is not None:
            target_id = skip_if.get("question_id") if isinstance(skip_if, dict) else None
            target = seen.get(target_id) if isinstance(target_id, str) else None
            if (
                not isinstance(skip_if, dict)
                or set(skip_if) != {"question_id", "value"}
                or target is None
                or target.get("type") not in ("integer", "likert")
                or not _is_int(skip_if.get("value"))
            ):
                errors.append(f"{label}: skip_if must name an earlier number/scale question and a whole-number value.")
        if isinstance(qid, str):
            seen.setdefault(qid, q)
    if errors:
        raise serializers.ValidationError(errors)
    return questions


class SurveyAdminSerializer(serializers.ModelSerializer):
    response_count = serializers.SerializerMethodField()

    class Meta:
        model = Survey
        fields = ["id", "code", "title", "type", "module", "questions", "response_count"]

    def get_response_count(self, obj):
        count = getattr(obj, "response_count", None)
        return count if count is not None else obj.responses.count()

    def get_fields(self):
        fields = super().get_fields()
        # The model defaults questions to [], which would let a survey be created empty.
        fields["questions"].required = self.instance is None
        return fields

    def validate_code(self, value):
        # The code ends up in the CSV download's filename.
        if not SURVEY_CODE_RE.match(value):
            raise serializers.ValidationError("Use only letters, digits, '-' and '_'.")
        return value

    def validate_questions(self, value):
        return validate_survey_questions(value)

    def validate(self, attrs):
        survey = self.instance
        if survey is not None and survey.responses.exists():
            for field in ("type", "module"):
                if field in attrs and attrs[field] != getattr(survey, field):
                    raise serializers.ValidationError(
                        {field: "Can't be changed once participants have responded."}
                    )
            if "questions" in attrs:
                def structure(qs):
                    return [tuple(q.get(k) for k in _SURVEY_STRUCTURE_KEYS) for q in qs]
                if structure(attrs["questions"]) != structure(survey.questions or []):
                    raise serializers.ValidationError({"questions": [
                        "Participants have already responded, so questions can't be added, removed, "
                        "reordered or change type, range or skip logic. Wording can still be edited."
                    ]})
        candidate = Survey(
            type=attrs.get("type", survey.type if survey else None),
            module=attrs.get("module", survey.module if survey else None),
        )
        try:
            candidate.clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.message_dict)
        # Every module gets a weekly survey automatically; the DB allows only one.
        if candidate.type == Survey.SurveyType.WEEKLY and candidate.module is not None:
            clash = Survey.objects.filter(module=candidate.module, type=Survey.SurveyType.WEEKLY)
            if survey is not None:
                clash = clash.exclude(pk=survey.pk)
            if clash.exists():
                raise serializers.ValidationError({"module": "This module already has a weekly survey."})
        return attrs


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


# ── Profile ────────────────────────────────────────────────────────────────────

class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        user = self.context["request"].user if "request" in self.context else None
        try:
            validate_password(value, user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value


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
            "daily_content_reminder",
            "survey_unlocked_reminder",
            "daily_survey_reminder",
        ]
        read_only_fields = ["id"]

    def validate_reminder_time(self, value):
        # send_due_reminders runs hourly and compares hours only.
        if value.minute or value.second:
            raise serializers.ValidationError("Reminder time must be on the hour (e.g. 08:00).")
        return value
