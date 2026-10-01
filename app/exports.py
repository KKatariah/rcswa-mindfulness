"""CSV export of survey responses for the research team."""

import csv
import io

from django.utils import timezone

from .models import Enrollment, SurveyResponse

# Characters that make Excel/Sheets treat a cell as a formula. Free-text answers
# starting with one are prefixed with ' so opening the file can't run anything.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _safe_cell(value):
    if value is None:
        return ""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def _question_ids(surveys):
    """Question ids across the surveys, in each survey's own order, without repeats."""
    ids = []
    for survey in surveys:
        for question in survey.questions or []:
            qid = question.get("id")
            if qid and qid not in ids:
                ids.append(qid)
    return ids


def _cohort_names(user_ids):
    """Each user's cohort: the latest active enrollment, else their latest enrollment of any status."""
    names = {}
    enrollments = (
        Enrollment.objects
        .filter(user_id__in=user_ids)
        .select_related("cohort")
        .order_by("enrolled_at")
    )
    for enr in enrollments:
        if enr.status == Enrollment.Status.ACTIVE or enr.user_id not in names:
            names[enr.user_id] = enr.cohort.name
    return names


def survey_responses_csv(surveys, include_identity=False):
    """Return the responses to *surveys* as CSV text, one row per response.

    Participants are identified by user id; names and emails are only included
    when *include_identity* is True.
    """
    surveys = list(surveys)
    question_ids = _question_ids(surveys)
    responses = list(
        SurveyResponse.objects
        .filter(survey__in=surveys)
        .select_related("survey__module", "user")
        .order_by("survey__module__week_number", "survey__code", "submitted_at")
    )
    cohorts = _cohort_names({r.user_id for r in responses})

    header = ["response_id", "survey_code", "survey_title", "week", "participant_id"]
    if include_identity:
        header += ["full_name", "email"]
    header += ["cohort", "submitted_at"] + question_ids

    out = io.StringIO()
    # BOM so Excel opens the file as UTF-8 (accents and emoji in journal answers).
    out.write("﻿")
    writer = csv.writer(out)
    writer.writerow(header)
    for r in responses:
        module = r.survey.module
        row = [r.pk, r.survey.code, r.survey.title, module.week_number if module else "", r.user_id]
        if include_identity:
            row += [r.user.full_name, r.user.email]
        row += [
            cohorts.get(r.user_id, ""),
            timezone.localtime(r.submitted_at).isoformat(timespec="seconds"),
        ]
        row += [(r.answers or {}).get(qid) for qid in question_ids]
        writer.writerow([_safe_cell(v) for v in row])
    return out.getvalue()
