"""Admin dashboard statistics. ORM aggregation only, no raw SQL."""

from collections import Counter

from django.db.models import Count, Q
from django.utils import timezone

from .access import unlock_date_for
from .models import (
    Cohort,
    ContentCompletion,
    ContentView,
    Enrollment,
    ForumFlag,
    ForumPost,
    ForumThread,
    Module,
    NotificationPreference,
    PushSubscription,
    Survey,
    SurveyResponse,
)
from .serializers import AdminUserSerializer
from .utils import gravatar_url


def dashboard_stats():
    active_user_ids = set(
        Enrollment.objects.filter(status=Enrollment.Status.ACTIVE).values_list("user_id", flat=True)
    )
    return {
        "total_enrolled": Enrollment.objects.filter(status=Enrollment.Status.ACTIVE).count(),
        "by_cohort": cohort_breakdown(),
        "modules": module_completion_stats(active_user_ids),
        "survey_response_rates": survey_response_rates(len(active_user_ids)),
        "forum_activity": forum_activity_stats(),
        "enrollment_status_breakdown": enrollment_status_breakdown(),
    }


def _pct(count, eligible_count):
    return round((count / eligible_count) * 100, 1) if eligible_count else 0.0


def cohort_breakdown():
    statuses = Enrollment.Status
    cohorts = Cohort.objects.annotate(
        enrolled=Count("enrollments"),
        pending=Count("enrollments", filter=Q(enrollments__status=statuses.PENDING)),
        active=Count("enrollments", filter=Q(enrollments__status=statuses.ACTIVE)),
        completed=Count("enrollments", filter=Q(enrollments__status=statuses.COMPLETED)),
        withdrawn=Count("enrollments", filter=Q(enrollments__status=statuses.WITHDRAWN)),
    ).order_by("-start_date")
    return [
        {
            "cohort_id": c.id,
            "cohort_name": str(c),
            "enrolled": c.enrolled,
            "pending": c.pending,
            "active": c.active,
            "completed": c.completed,
            "withdrawn": c.withdrawn,
        }
        for c in cohorts
    ]


def module_completion_stats(active_user_ids):
    """Completion % of published modules among ACTIVE-enrolled students. A student
    "completes" a module when they've completed every ContentItem in it, the same
    all-items rule that unlocks the module's survey."""
    eligible_count = len(active_user_ids)
    modules = list(Module.objects.filter(is_published=True).prefetch_related("content_items"))
    item_counts = {m.id: len(m.content_items.all()) for m in modules}
    item_ids = [item.id for m in modules for item in m.content_items.all()]

    # One query for every module: how many distinct items each student has done per module.
    completed_counts = Counter()
    if item_ids and active_user_ids:
        rows = (
            ContentCompletion.objects
            .filter(user_id__in=active_user_ids, content_item_id__in=item_ids)
            .values("user_id", "content_item__module_id")
            .annotate(n=Count("content_item_id", distinct=True))
        )
        for row in rows:
            module_id = row["content_item__module_id"]
            if row["n"] == item_counts[module_id]:
                completed_counts[module_id] += 1

    return [
        {
            "id": m.id,
            "week_number": m.week_number,
            "title": m.title,
            "completed_count": completed_counts[m.id],
            "eligible_count": eligible_count,
            "completion_pct": _pct(completed_counts[m.id], eligible_count),
        }
        for m in modules
    ]


def survey_response_rates(eligible_count):
    surveys = Survey.objects.annotate(response_count=Count("responses"))
    return [
        {
            "survey_id": survey.id,
            "code": survey.code,
            "title": survey.title,
            "response_count": survey.response_count,
            "eligible_count": eligible_count,
            "response_pct": _pct(survey.response_count, eligible_count),
        }
        for survey in surveys
    ]


def forum_activity_stats():
    live_posts = ForumPost.objects.filter(is_deleted=False).exclude(thread__opened_by__is_deleted=True)
    return {
        "thread_count": ForumThread.objects.exclude(opened_by__is_deleted=True).count(),
        "post_count": live_posts.count(),
        "active_participants": live_posts.values("author").distinct().count(),
        "reported_post_count": ForumFlag.objects.filter(resolved_at__isnull=True).values("post").distinct().count(),
    }


def enrollment_status_breakdown():
    rows = Enrollment.objects.values("status").annotate(n=Count("id"))
    breakdown = {choice: 0 for choice in Enrollment.Status.values}
    for row in rows:
        breakdown[row["status"]] = row["n"]
    return breakdown


# ── Admin views of individual progress ──────────────────────────────────────────

def _progress_status(done_count, item_count, unlock_date, today):
    """One student's standing in one module. unlock_date is None when they have no active cohort."""
    if item_count and done_count == item_count:
        return "completed"
    if done_count:
        return "in_progress"
    if unlock_date is None or unlock_date > today:
        return "locked"
    return "not_started"


def module_student_progress(module, cohort_id=None):
    """Per-student progress through one module, for every ACTIVE-enrolled student
    (optionally limited to one cohort). Uses the same all-items definition of
    "completed" as module_completion_stats."""
    enrollments = (
        Enrollment.objects
        .filter(status=Enrollment.Status.ACTIVE)
        .select_related("user", "cohort")
        .order_by("user__full_name", "user__email", "-enrolled_at")
    )
    if cohort_id:
        enrollments = enrollments.filter(cohort_id=cohort_id)
    # A student can hold more than one active enrollment; their most recent one
    # decides their cohort and so when this module unlocked for them.
    by_user = {}
    for e in enrollments:
        existing = by_user.get(e.user_id)
        if existing is None or e.enrolled_at > existing.enrolled_at:
            by_user[e.user_id] = e

    item_ids = list(module.content_items.values_list("id", flat=True))
    completions = {}
    last_activity = {}
    for user_id, item_id, completed_at in (
        ContentCompletion.objects
        .filter(user_id__in=by_user, content_item_id__in=item_ids)
        .values_list("user_id", "content_item_id", "completed_at")
    ):
        completions.setdefault(user_id, []).append(item_id)
        if user_id not in last_activity or completed_at > last_activity[user_id]:
            last_activity[user_id] = completed_at

    viewed = set(
        ContentView.objects.filter(module=module, user_id__in=by_user).values_list("user_id", flat=True)
    )
    survey = Survey.objects.filter(module=module, type=Survey.SurveyType.WEEKLY).first()
    responded = (
        set(SurveyResponse.objects.filter(survey=survey, user_id__in=by_user).values_list("user_id", flat=True))
        if survey else set()
    )

    today = timezone.localdate()
    students = []
    for user_id, enrollment in by_user.items():
        user = enrollment.user
        done = completions.get(user_id, [])
        unlock_date = unlock_date_for(enrollment.cohort.start_date, module.week_number)
        students.append({
            "user_id": user_id,
            "full_name": user.full_name or user.display_name,
            "email": user.email,
            "cohort_id": enrollment.cohort_id,
            "cohort_name": enrollment.cohort.name,
            "unlock_date": unlock_date.isoformat(),
            "status": _progress_status(len(done), len(item_ids), unlock_date, today),
            "completed_item_ids": sorted(done),
            "viewed": user_id in viewed,
            "survey_submitted": user_id in responded if survey else None,
            "last_activity": last_activity[user_id].isoformat() if user_id in last_activity else None,
        })

    return {
        "item_count": len(item_ids),
        "survey": {"id": survey.id, "title": survey.title} if survey else None,
        "students": students,
    }


def user_overview(user):
    """Everything the admin portal shows on one person's profile page."""
    today = timezone.localdate()
    enrollments = list(
        Enrollment.objects.filter(user=user).select_related("cohort").order_by("-enrolled_at")
    )
    active = next((e for e in enrollments if e.status == Enrollment.Status.ACTIVE), None)

    completions = {
        item_id: completed_at
        for item_id, completed_at in ContentCompletion.objects.filter(user=user)
        .values_list("content_item_id", "completed_at")
    }
    responses = {
        r.survey_id: r.submitted_at for r in SurveyResponse.objects.filter(user=user)
    }
    weekly_survey_by_module = {
        s.module_id: s for s in Survey.objects.filter(type=Survey.SurveyType.WEEKLY, module__isnull=False)
    }

    modules = []
    for module in Module.objects.filter(is_published=True).prefetch_related("content_items").order_by("week_number"):
        item_ids = [i.id for i in module.content_items.all()]
        done = [completions[i] for i in item_ids if i in completions]
        unlock_date = unlock_date_for(active.cohort.start_date, module.week_number) if active else None
        survey = weekly_survey_by_module.get(module.id)
        modules.append({
            "id": module.id,
            "week_number": module.week_number,
            "title": module.title,
            "item_count": len(item_ids),
            "completed_count": len(done),
            "status": _progress_status(len(done), len(item_ids), unlock_date, today),
            "unlock_date": unlock_date.isoformat() if unlock_date else None,
            "survey_submitted": (survey.id in responses) if survey else None,
            "last_activity": max(done).isoformat() if done else None,
        })

    surveys = [
        {
            "id": s.id,
            "title": s.title,
            "type": s.type,
            "week_number": s.module.week_number if s.module else None,
            "submitted_at": responses[s.id].isoformat() if s.id in responses else None,
        }
        for s in Survey.objects.select_related("module").order_by("module__week_number", "id")
    ]

    posts = ForumPost.objects.filter(author=user, is_deleted=False)
    recent_posts = [
        {
            "id": p.id,
            "thread_title": p.thread.title,
            "body": p.body[:200],
            "is_head_post": p.is_head_post,
            "created_at": p.created_at.isoformat(),
        }
        for p in posts.select_related("thread").order_by("-created_at")[:5]
    ]

    pref = NotificationPreference.objects.filter(user=user).first()
    return {
        "user": {
            **AdminUserSerializer(user).data,
            "avatar_url": gravatar_url(user.email),
            "forum_rules_accepted_at": (
                user.forum_rules_accepted_at.isoformat() if user.forum_rules_accepted_at else None
            ),
        },
        "enrollments": [
            {
                "id": e.id,
                "cohort_id": e.cohort_id,
                "cohort_name": e.cohort.name,
                "cohort_start_date": e.cohort.start_date.isoformat(),
                "cohort_end_date": e.cohort.end_date.isoformat(),
                "status": e.status,
                "enrolled_at": e.enrolled_at.isoformat(),
            }
            for e in enrollments
        ],
        "modules": modules,
        "surveys": surveys,
        "forum": {
            "thread_count": ForumThread.objects.filter(created_by=user).exclude(opened_by__is_deleted=True).count(),
            "post_count": posts.filter(is_head_post=False).count(),
            "recent_posts": recent_posts,
        },
        "notifications": {
            "push_devices": PushSubscription.objects.filter(user=user).count(),
            "push_denied": pref.push_denied if pref else False,
            "reminder_time": pref.reminder_time.strftime("%H:%M") if pref else "17:00",
            "daily_content_reminder": pref.daily_content_reminder if pref else True,
            "daily_survey_reminder": pref.daily_survey_reminder if pref else False,
        },
    }
