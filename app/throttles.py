import re

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class MultiPeriodRateMixin:
    """Lets rates use multi-unit windows: "10/min", "10/hour", and also "10/5m", "5/2h"."""

    def parse_rate(self, rate):
        if rate is None:
            return (None, None)
        num, period = rate.split("/")
        match = re.match(r"^(\d*)(s|m|h|d)", period)
        count = int(match.group(1) or 1)
        unit = {"s": 1, "m": 60, "h": 3600, "d": 86400}[match.group(2)]
        return (int(num), count * unit)


class AuthRateThrottle(MultiPeriodRateMixin, AnonRateThrottle):
    """Per-IP limit on login and Google login to slow password guessing."""

    scope = "auth"


class RegisterRateThrottle(MultiPeriodRateMixin, AnonRateThrottle):
    """Per-IP limit on sign-ups, so the approvals queue can't be flooded."""

    scope = "register"


class ForumFlagRateThrottle(MultiPeriodRateMixin, UserRateThrottle):
    """Per-user limit on reporting forum posts, so the moderation queue can't be flooded."""

    scope = "forum_flag"
    
