"""Admin dashboard statistics. ORM aggregation only, no raw SQL."""

from collections import Counter

from django.db.models import Count, Q

from .models import Cohort, ContentCompletion, Enrollment, ForumPost, ForumThread, Module, Survey


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
    live_posts = ForumPost.objects.filter(is_deleted=False)
    return {
        "thread_count": ForumThread.objects.count(),
        "post_count": live_posts.count(),
        "active_participants": live_posts.values("author").distinct().count(),
    }


def enrollment_status_breakdown():
    rows = Enrollment.objects.values("status").annotate(n=Count("id"))
    breakdown = {choice: 0 for choice in Enrollment.Status.values}
    for row in rows:
        breakdown[row["status"]] = row["n"]
    return breakdown
