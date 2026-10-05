"""Per-account lock after repeated wrong passwords, on top of the per-IP rate limit."""

import logging
import math
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.utils import timezone

logger = logging.getLogger(__name__)

# This many wrong passwords in a row locks the account for LOCK_DURATION.
MAX_FAILED_LOGINS = 5
LOCK_DURATION = timedelta(minutes=15)


def lock_minutes_left(user):
    """Whole minutes until the account unlocks, or 0 if it isn't locked."""
    if not user.locked_until:
        return 0
    seconds = (user.locked_until - timezone.now()).total_seconds()
    return math.ceil(seconds / 60) if seconds > 0 else 0


def _record_failure(user):
    count = user.failed_login_count + 1
    if count >= MAX_FAILED_LOGINS:
        # The count restarts, so after the lock ends there are another few attempts before the next one.
        user.failed_login_count, user.locked_until = 0, timezone.now() + LOCK_DURATION
        logger.warning("User %s locked out after %d wrong passwords", user.pk, MAX_FAILED_LOGINS)
    else:
        user.failed_login_count = count
    user.save(update_fields=["failed_login_count", "locked_until"])


def _record_success(user):
    if user.failed_login_count or user.locked_until:
        user.failed_login_count, user.locked_until = 0, None
        user.save(update_fields=["failed_login_count", "locked_until"])


class LockoutModelBackend(ModelBackend):
    """ModelBackend that counts wrong passwords and refuses a locked account outright.

    Used for every password login: the API's /login/ and the Django admin.
    While locked, the password isn't even checked, so guessing gains nothing.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        user_model = get_user_model()
        if username is None:
            username = kwargs.get(user_model.USERNAME_FIELD)
        if username is None or password is None:
            return None
        try:
            user = user_model._default_manager.get_by_natural_key(username)
        except user_model.DoesNotExist:
            # Same cost as a real check, so response time doesn't reveal which emails exist.
            user_model().set_password(password)
            return None
        if lock_minutes_left(user):
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            _record_success(user)
            return user
        _record_failure(user)
        return None
