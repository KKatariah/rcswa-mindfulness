from rest_framework.throttling import AnonRateThrottle


class AuthRateThrottle(AnonRateThrottle):
    """Per-IP limit on login, register and Google login to slow password guessing."""

    scope = "auth"
