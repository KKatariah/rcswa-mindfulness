"""Per-account lock after repeated wrong passwords, on top of the per-IP rate limit.

Emails with no account are counted and locked the same way, so neither the error
message nor the lock reveals which emails are registered.
"""

import hashlib
import hmac
import logging
import math
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.utils import timezone

logger = logging.getLogger(__name__)

# This many wrong passwords in a row locks the account for LOCK_DURATION.
MAX_FAILED_LOGINS = 5
LOCK_DURATION = timedelta(minutes=5)
# Unknown-email entries untouched this long are deleted, so the table doesn't grow forever.
UNKNOWN_EMAIL_RETENTION = timedelta(days=30)


def lock_minutes_left(entry):
    """Whole minutes until the account (or unknown-email entry) unlocks, or 0 if it isn't locked."""
    if entry is None or not entry.locked_until:
        return 0
    seconds = (entry.locked_until - timezone.now()).total_seconds()
    return math.ceil(seconds / 60) if seconds > 0 else 0


def _record_failure(entry):
    """Count a wrong password on a user or an UnknownEmailLockout; both have the same two fields."""
    count = entry.failed_login_count + 1
    if count >= MAX_FAILED_LOGINS:
        # The count restarts, so after the lock ends there are another few attempts before the next one.
        entry.failed_login_count, entry.locked_until = 0, timezone.now() + LOCK_DURATION
        if isinstance(entry, get_user_model()):
            logger.warning("User %s locked out after %d wrong passwords", entry.pk, MAX_FAILED_LOGINS)
        else:
            logger.warning("Unknown email locked out after %d wrong passwords", MAX_FAILED_LOGINS)
    else:
        entry.failed_login_count = count
    entry.save(update_fields=["failed_login_count", "locked_until"] + (
        [] if isinstance(entry, get_user_model()) else ["updated_at"]
    ))


def _email_hash(email):
    # Keyed, so the stored hashes can't be checked against a list of guessed emails.
    normalized = email.strip().lower().encode()
    return hmac.new(settings.SECRET_KEY.encode(), normalized, hashlib.sha256).hexdigest()


def unknown_email_entry(email):
    """The lock entry for an email with no account, or None if it has had no wrong passwords."""
    from .models import UnknownEmailLockout

    return UnknownEmailLockout.objects.filter(email_hash=_email_hash(email)).first()


def _record_unknown_email_failure(email):
    from .models import UnknownEmailLockout

    UnknownEmailLockout.objects.filter(
        updated_at__lt=timezone.now() - UNKNOWN_EMAIL_RETENTION,
    ).exclude(locked_until__gt=timezone.now()).delete()
    entry, _ = UnknownEmailLockout.objects.get_or_create(email_hash=_email_hash(email))
    _record_failure(entry)


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
            # Same cost and the same lock as a real account, so neither response time nor
            # the lock message reveals which emails exist.
            user_model().set_password(password)
            if not lock_minutes_left(unknown_email_entry(username)):
                _record_unknown_email_failure(username)
            return None
        if lock_minutes_left(user):
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            _record_success(user)
            return user
        _record_failure(user)
        return None
