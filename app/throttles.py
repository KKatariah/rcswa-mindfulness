from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class AuthRateThrottle(AnonRateThrottle):
    """Per-IP limit on login, register and Google login to slow password guessing."""

    scope = "auth"


class ForumFlagRateThrottle(UserRateThrottle):
    """Per-user limit on reporting forum posts, so the moderation queue can't be flooded."""

    scope = "forum_flag"
