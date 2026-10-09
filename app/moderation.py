"""Forum moderation: acting on reported posts and banning people from posting.

A ban stops someone posting, replying, editing or reporting in the forum; they can
still read it, and the rest of the programme (modules, surveys) is unaffected.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .access import is_admin
from .models import ForumFlag

# Ban lengths an admin can pick, in days; None bans until an admin lifts it.
FORUM_BAN_DAYS = (1, 7, 30)


def forum_ban_message(user):
    if user.forum_banned_until is None:
        return "You have been banned from posting in the forum. Contact the moderators if you think this is a mistake."
    until = timezone.localtime(user.forum_banned_until).strftime("%d %b %Y at %H:%M")
    return f"You have been banned from posting in the forum until {until}."


def require_not_forum_banned(user):
    if user.is_forum_banned:
        raise PermissionDenied(forum_ban_message(user))


def parse_ban_days(data):
    """The `days` of a ban request: one of FORUM_BAN_DAYS, or null/absent for until lifted."""
    days = data.get("days")
    if days is None:
        return None
    if isinstance(days, bool) or days not in FORUM_BAN_DAYS:
        raise ValidationError({"days": f"Must be one of {', '.join(map(str, FORUM_BAN_DAYS))}, or null."})
    return days


def ban_from_forum(user, days, by):
    if user is None:
        raise ValidationError({"detail": "This post's author has deleted their account."})
    if user.pk == by.pk:
        raise ValidationError({"detail": "You can't ban yourself."})
    if is_admin(user):
        raise ValidationError({"detail": "Admins can't be banned from the forum."})
    now = timezone.now()
    user.forum_banned_at = now
    user.forum_banned_until = now + timedelta(days=days) if days else None
    user.save(update_fields=["forum_banned_at", "forum_banned_until"])


def lift_forum_ban(user):
    user.forum_banned_at = None
    user.forum_banned_until = None
    user.save(update_fields=["forum_banned_at", "forum_banned_until"])


def resolve_flags(post, resolution, by):
    """Close every open report on the post."""
    post.flags.filter(resolved_at__isnull=True).update(
        resolved_at=timezone.now(), resolved_by=by, resolution=resolution
    )


MODERATION_ACTIONS = ("dismiss", "hide", "ban")


def moderate_post(post, action, by, ban_days=None):
    """An admin's decision on a reported post.

    dismiss: the post stays up. hide: the post is removed (a thread's opening post takes the
    thread with it). ban: the post is removed and its author is banned from posting.
    Every open report on the post is closed either way.
    """
    if action not in MODERATION_ACTIONS:
        raise ValidationError({"action": f"Must be one of {', '.join(MODERATION_ACTIONS)}."})
    with transaction.atomic():
        if action == "ban":
            ban_from_forum(post.author, ban_days, by)
        if action in ("hide", "ban") and not post.is_deleted:
            post.soft_delete(by)
        resolution = {
            "dismiss": ForumFlag.Resolution.DISMISSED,
            "hide": ForumFlag.Resolution.HIDDEN,
            "ban": ForumFlag.Resolution.BANNED,
        }[action]
        resolve_flags(post, resolution, by)
