from django.utils import timezone
from rest_framework import serializers

from .models import ContentCompletion, ContentItem, Module, Resource, Survey, SurveyResponse, User


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
