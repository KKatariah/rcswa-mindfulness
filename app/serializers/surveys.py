"""Surveys: definitions, validation of questions and answers, and responses."""

import re

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from ..access import (
    survey_is_unlocked,
)
from ..models import (
    Survey,
    SurveyResponse,
)


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
            # Record the version of the questions these answers were given to.
            attrs["questions"] = survey.questions
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


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _shape_errors(q, index, label, seen):
    """Unknown fields, a bad or duplicate id, an unknown type, and fields for a different type."""
    errors = []
    unknown = set(q) - _SURVEY_QUESTION_KEYS
    if unknown:
        errors.append(f"{label}: unknown field(s) {', '.join(sorted(unknown))}.")
    qid = q.get("id")
    if not isinstance(qid, str) or not SURVEY_QUESTION_ID_RE.match(qid):
        errors.append(f"Question {index}: id must be 1-30 letters, digits, '-' or '_'.")
    elif qid in seen:
        errors.append(f"{label}: duplicate id.")
    if q.get("type") not in SURVEY_QUESTION_TYPES:
        errors.append(f"{label}: type must be one of {', '.join(SURVEY_QUESTION_TYPES)}.")
    misplaced = sorted(k for k, t in _SURVEY_TYPE_ONLY_KEYS.items() if k in q and q.get("type") != t)
    if misplaced:
        errors.append(f"{label}: {', '.join(misplaced)} not allowed on {q.get('type')} questions.")
    return errors


def _text_errors(q, label):
    """The question text is required; text, section, unit and scale labels must be short, clean strings."""
    errors = []
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
    return errors


def _likert_errors(q, label):
    """A scale question needs a sensible whole-number range and labels keyed by scale value."""
    if q.get("type") != "likert":
        return []
    errors = []
    lo, hi = q.get("min"), q.get("max")
    if not (_is_int(lo) and _is_int(hi) and lo < hi <= lo + 10):
        errors.append(f"{label}: likert questions need whole-number min < max, at most 10 apart.")
    labels = q.get("scale_labels", {})
    if not isinstance(labels, dict) or not all(isinstance(v, str) and k.lstrip("-").isdigit() for k, v in labels.items()):
        errors.append(f"{label}: scale_labels must map scale values to text.")
    return errors


def _skip_if_errors(q, label, seen, all_ids):
    """skip_if must point at an earlier number or scale question and give a whole-number value.

    Three distinct failure modes are reported separately so the admin knows exactly what to fix:
    - The referenced question comes *after* this one (ordering violation).
    - The referenced question is free-text (can't be a skip trigger).
    - The trigger value is not a whole number.
    """
    skip_if = q.get("skip_if")
    if skip_if is None:
        return []
    if not isinstance(skip_if, dict) or set(skip_if) != {"question_id", "value"}:
        return [f"{label}: skip_if must have exactly the question_id and value fields."]
    target_id = skip_if.get("question_id")
    if not isinstance(target_id, str):
        return [f"{label}: skip_if question_id must be a text identifier."]
    value = skip_if.get("value")
    target = seen.get(target_id)
    errors = []
    if target is None:
        if target_id in all_ids:
            errors.append(
                f"{label}: the skip rule references \"{target_id}\", which comes after it — "
                "move that question above this one, or remove the skip rule."
            )
        else:
            errors.append(
                f"{label}: the skip rule references \"{target_id}\", which doesn't exist."
            )
        return errors
    if target.get("type") not in ("integer", "likert"):
        errors.append(
            f"{label}: the skip rule uses \"{target_id}\", a free-text question — "
            "only rating scale or number questions can trigger a skip."
        )
    if not _is_int(value):
        errors.append(
            f"{label}: the skip rule's trigger value must be a whole number."
        )
    return errors


def validate_survey_questions(questions):
    """Check a survey's question definitions; raise ValidationError listing every problem."""
    if not isinstance(questions, list) or not questions:
        raise serializers.ValidationError("A survey needs at least one question.")
    if len(questions) > SURVEY_MAX_QUESTIONS:
        raise serializers.ValidationError(f"A survey can have at most {SURVEY_MAX_QUESTIONS} questions.")
    errors = []
    all_ids = {q["id"] for q in questions if isinstance(q, dict) and isinstance(q.get("id"), str)}
    # Questions checked so far, by id, for duplicate ids and skip_if targets.
    seen = {}
    for index, q in enumerate(questions, start=1):
        if not isinstance(q, dict):
            errors.append(f"Question {index}: must be an object.")
            continue
        qid = q.get("id")
        label = f"Question {index} ({qid})" if isinstance(qid, str) else f"Question {index}"
        errors += _shape_errors(q, index, label, seen)
        errors += _text_errors(q, label)
        errors += _likert_errors(q, label)
        errors += _skip_if_errors(q, label, seen, all_ids)
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

    @staticmethod
    def _check_question_ids_keep_meaning(survey, questions):
        current = {q["id"]: q for q in survey.questions or []}
        answered = set()
        for answers in survey.responses.values_list("answers", flat=True):
            answered.update(answers or {})
        errors = []
        for q in questions:
            qid = q["id"]
            if qid not in current and qid in answered:
                errors.append(
                    f"Question {qid}: this id belonged to a removed question that participants answered. "
                    "Give the new question a different id."
                )
            elif qid in current and q["type"] != current[qid]["type"] and qid in answered:
                errors.append(
                    f"Question {qid}: participants have answered this question, so it needs a new id to "
                    "change answer type. Remove it and add a new question instead."
                )
        if errors:
            raise serializers.ValidationError({"questions": errors})

    def validate(self, attrs):
        survey = self.instance
        if survey is not None and survey.responses.exists():
            for field in ("type", "module"):
                if field in attrs and attrs[field] != getattr(survey, field):
                    raise serializers.ValidationError(
                        {field: "Can't be changed once participants have responded."}
                    )
            if "questions" in attrs:
                # Questions may be edited, reordered, added or removed after people respond:
                # each response keeps the questions it answered, and changed ones are flagged.
                # Answers are matched to questions by id, so an id must keep meaning one thing.
                self._check_question_ids_keep_meaning(survey, attrs["questions"])
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
