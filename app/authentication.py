"""Token authentication with one token per device and a sliding expiry."""

from datetime import timedelta

from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import AuthToken

# A token expires after this long without being used; every use extends it.
TOKEN_IDLE_LIFETIME = timedelta(days=7)
# last_used is only written when it is at least this stale, not on every request.
LAST_USED_RESOLUTION = timedelta(minutes=5)


class ExpiringTokenAuthentication(TokenAuthentication):
    """Accepts `Authorization: Token <key>` for an AuthToken used within TOKEN_IDLE_LIFETIME."""

    def authenticate_credentials(self, key):
        token = AuthToken.find(key)
        if token is None:
            raise AuthenticationFailed("Invalid token.")
        now = timezone.now()
        if token.last_used < now - TOKEN_IDLE_LIFETIME:
            token.delete()
            raise AuthenticationFailed("Your session has expired. Please log in again.")
        if not token.user.is_active:
            raise AuthenticationFailed("User inactive or deleted.")
        if token.last_used < now - LAST_USED_RESOLUTION:
            AuthToken.objects.filter(pk=token.pk).update(last_used=now)
        return (token.user, token)
