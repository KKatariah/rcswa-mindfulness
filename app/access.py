"""Access rules shared by the API, notifications and management commands.

Who counts as an admin, when a module opens for a student, and when a survey
unlocks are each decided here, so every caller applies the same rule.
"""

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from .models import Cohort, ContentCompletion, Enrollment, ForumThread, Survey, SurveyResponse


def is_admin(user):
    """True for app admins. Staff status follows the role on save, but both are checked."""
    return bool(
        user and user.is_authenticated
        and (getattr(user, "role", None) == "admin" or user.is_staff)
    )


def can_edit_forum_item(user, obj):
    """Admins can edit any thread or post; everyone else only their own."""
    if is_admin(user):
        return True
    if not (user and user.is_authenticated):
        return False
    if isinstance(obj, ForumThread):
        return obj.created_by_id == user.pk
    return obj.author_id == user.pk


# ── Cohorts & module unlocking ─────────────────────────────────────────────────

def active_cohort_start_date(user):
    """Start date of the user's most recent active cohort, or None."""
    enrollment = (
        Enrollment.objects
        .filter(user=user, status=Enrollment.Status.ACTIVE)
        .select_related("cohort")
        .order_by("-enrolled_at")
        .first()
    )
    return enrollment.cohort.start_date if enrollment else None


def _cached_cohort_start_date(user):
    """active_cohort_start_date, cached on the user object for the rest of the request."""
    if not hasattr(user, "_cohort_start_date"):
        user._cohort_start_date = active_cohort_start_date(user)
    return user._cohort_start_date


def unlock_date_for(cohort_start, week_number):
    """Week N opens (N-1) weeks after the cohort starts; the week 0 introduction opens with week 1."""
    return cohort_start + timedelta(weeks=max(week_number - 1, 0))


def module_unlock_date(module, user):
    """When the module opens for this user; None when they have no active cohort."""
    start = _cached_cohort_start_date(user)
    return unlock_date_for(start, module.week_number) if start else None


def module_is_unlocked(module, user):
    if is_admin(user):
        return True  # admins can open any module early to prepare content
    if not module.is_published:
        return False
    unlock_date = module_unlock_date(module, user)
    return unlock_date is not None and unlock_date <= timezone.localdate()


# ── Surveys ────────────────────────────────────────────────────────────────────

# Enrollment statuses whose surveys count as research data. "completed" covers the
# end-of-program and follow-up surveys answered after a cohort finishes.
PARTICIPANT_STATUSES = (Enrollment.Status.ACTIVE, Enrollment.Status.COMPLETED)


def is_participant(user):
    """True for an approved participant (active or completed enrollment). Cached on the user."""
    if not hasattr(user, "_is_participant"):
        user._is_participant = Enrollment.objects.filter(user=user, status__in=PARTICIPANT_STATUSES).exists()
    return user._is_participant


def module_content_completed(module, user, completed_ids=None):
    """True when the user has completed every content item in the module (or it has none).

    Pass *completed_ids* (the user's completed content item ids) when checking many
    modules, and prefetch ``content_items``, to avoid a query per module.
    """
    required_ids = {item.id for item in module.content_items.all()}
    if not required_ids:
        return True
    if completed_ids is None:
        completed_ids = set(
            ContentCompletion.objects.filter(user=user, content_item_id__in=required_ids)
            .values_list("content_item_id", flat=True)
        )
    return required_ids <= completed_ids


def survey_is_unlocked(survey, user, completed_ids=None, responded_ids=None):
    """A survey unlocks once its module is open and all of the module's content is complete.

    *completed_ids* and *responded_ids* (survey ids the user has answered) can be passed
    in when checking many surveys, so each check needs no queries of its own.
    """
    # Once submitted, content added to the module later must not re-lock it.
    if responded_ids is not None:
        responded = survey.pk in responded_ids
    else:
        responded = SurveyResponse.objects.filter(user=user, survey=survey).exists()
    if responded:
        return True
    # Pending, withdrawn and never-approved accounts can't add to the research data.
    # Admins can, so they can try surveys out.
    if not is_admin(user) and not is_participant(user):
        return False
    if survey.module_id is None:
        # Weekly surveys always require a module; guard against misconfigured data.
        return survey.type != Survey.SurveyType.WEEKLY
    if not module_is_unlocked(survey.module, user):
        return False
    return module_content_completed(survey.module, user, completed_ids)


# ── Program dates ────────────────────────────────────────────────────────────
# Computed on read, not stored: archive state is always derived fresh from today's date.

def is_program_active(today=None):
    """True if `today` falls within [start_date, end_date] of ANY cohort.
    The forum is read-only (not hidden) whenever this is False. If no cohort has
    ever been created, there is no "program" to have ended yet, so stay open."""
    if not Cohort.objects.exists():
        return True
    today = today or timezone.localdate()
    return Cohort.objects.filter(start_date__lte=today, end_date__gte=today).exists()


def running_cohort(today=None):
    """The cohort running today (the most recently started, if they overlap), or None."""
    today = today or timezone.localdate()
    return (
        Cohort.objects.filter(start_date__lte=today, end_date__gte=today)
        .order_by("-start_date", "-pk")
        .first()
    )


# ── Forum cohorts ─────────────────────────────────────────────────────────────

def forum_cohort(user):
    """The cohort whose forum the user belongs to: their most recent active enrollment.
    Cached on the user object for the rest of the request."""
    if not hasattr(user, "_forum_cohort"):
        enrollment = (
            Enrollment.objects
            .filter(user=user, status=Enrollment.Status.ACTIVE)
            .select_related("cohort")
            .order_by("-enrolled_at", "-pk")
            .first()
        )
        user._forum_cohort = enrollment.cohort if enrollment else None
    return user._forum_cohort


def forum_cohort_id(user):
    cohort = forum_cohort(user)
    return cohort.pk if cohort else None


def cohort_has_ended(cohort, today=None):
    return cohort.end_date < (today or timezone.localdate())


def cohort_is_running(cohort, today=None):
    today = today or timezone.localdate()
    return cohort.start_date <= today <= cohort.end_date


def forum_opens_on(user, today=None):
    """The start date of the user's cohort while it hasn't started yet, else None."""
    cohort = None if is_admin(user) else forum_cohort(user)
    if cohort is not None and cohort.start_date > (today or timezone.localdate()):
        return cohort.start_date
    return None


def admin_thread_cohorts(today=None):
    """Cohorts an admin can start a thread in: any that hasn't ended, running ones first."""
    today = today or timezone.localdate()
    return Cohort.objects.filter(end_date__gte=today).order_by("-start_date", "-pk")


def can_start_forum_thread(user, today=None):
    """Students can post from the day their cohort starts until the day it ends; outside
    that its forum is read-only. Admins can post while any cohort hasn't ended yet."""
    if is_admin(user):
        return not Cohort.objects.exists() or admin_thread_cohorts(today).exists()
    cohort = forum_cohort(user)
    if cohort is None:
        return is_program_active(today)
    return cohort_is_running(cohort, today)


def can_reply_to_forum_thread(user, thread, today=None):
    """A thread can only be replied to (or edited) while its cohort is running, for admins
    too. A thread with no cohort follows the replier's own cohort."""
    if thread.cohort_id is None:
        return can_start_forum_thread(user, today)
    return cohort_is_running(thread.cohort, today)


def cohort_for_new_thread(user):
    """Students post to their own cohort. An admin who doesn't pick one posts to the
    cohort running right now, else the next one to start."""
    if is_admin(user):
        cohort = running_cohort() or admin_thread_cohorts().order_by("start_date", "pk").first()
        return cohort.pk if cohort else None
    return forum_cohort_id(user)


def visible_forum_threads(qs, user):
    """Narrow a ForumThread queryset to what the user may see. Admins see every cohort;
    students see their own cohort's threads plus any that have no cohort (posted
    before any cohort existed)."""
    if is_admin(user):
        return qs
    cohort_id = forum_cohort_id(user)
    if cohort_id is None:
        return qs.filter(cohort__isnull=True)
    return qs.filter(Q(cohort__isnull=True) | Q(cohort_id=cohort_id))


def pick_signup_cohort(today=None):
    """The cohort a new signup should be auto-enrolled into: the currently
    active one, or if none is active, the soonest upcoming one. None if
    neither exists."""
    today = today or timezone.localdate()
    active = (
        Cohort.objects.filter(start_date__lte=today, end_date__gte=today)
        .order_by("start_date")
        .first()
    )
    if active:
        return active
    return Cohort.objects.filter(start_date__gt=today).order_by("start_date").first()
