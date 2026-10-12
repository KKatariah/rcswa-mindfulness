"""Push subscriptions, notification preferences and the in-app inbox."""

from urllib.parse import urlsplit

from rest_framework import serializers

from ..models import (
    NotificationLog,
    NotificationPreference,
    PushSubscription,
)


# The server POSTs to every stored endpoint, so only the browsers' push services are
# accepted (Chrome, Firefox, Safari, Edge); any other URL would let a user point the
# server at arbitrary hosts, internal ones included.
PUSH_SERVICE_HOSTS = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
)
# Real values are far shorter (p256dh 87 chars, auth 22, endpoints a few hundred).
PUSH_ENDPOINT_MAX_CHARS = 1000
PUSH_KEY_MAX_CHARS = 200


def is_push_service_host(host):
    return any(host == h or host.endswith("." + h) for h in PUSH_SERVICE_HOSTS)


class PushSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushSubscription
        fields = ["id", "endpoint", "p256dh", "auth", "created_at", "last_seen"]
        read_only_fields = ["id", "created_at", "last_seen"]
        extra_kwargs = {
            "endpoint": {"validators": [], "max_length": PUSH_ENDPOINT_MAX_CHARS},
            "p256dh": {"max_length": PUSH_KEY_MAX_CHARS},
            "auth": {"max_length": PUSH_KEY_MAX_CHARS},
        }

    def validate_endpoint(self, value):
        try:
            url = urlsplit(value)
            port = url.port
        except ValueError:
            port = -1
        if (
            url.scheme != "https"
            or port not in (None, 443)
            or url.username is not None
            or not is_push_service_host(url.hostname or "")
        ):
            raise serializers.ValidationError("Not a browser push service endpoint.")
        return value


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = [
            "id",
            "inapp_enabled",
            "reminder_time",
            "push_denied",
            "daily_content_reminder",
            "survey_unlocked_reminder",
            "daily_survey_reminder",
        ]
        read_only_fields = ["id"]

    def validate_reminder_time(self, value):
        # send_due_reminders runs hourly and compares hours only.
        if value.minute or value.second:
            raise serializers.ValidationError("Reminder time must be on the hour (e.g. 08:00).")
        return value


class NotificationLogSerializer(serializers.ModelSerializer):
    """A delivered notification as shown in the user's in-app inbox.

    The log doesn't store the message text, so title/body/url are rebuilt from
    the type and module the same way the senders build their push payloads.
    """

    title = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()

    class Meta:
        model = NotificationLog
        fields = ["id", "type", "channel", "sent_at", "read_at", "title", "body", "url"]
        read_only_fields = fields

    def get_title(self, obj):
        Type = NotificationLog.NotificationType
        week = obj.module.week_label if obj.module else None
        if obj.type == Type.CONTENT_REMINDER:
            return "Time for your daily meditation"
        if obj.type == Type.SURVEY_PROMPT:
            return "Your survey is ready"
        if obj.type == Type.CONTENT_UPDATE:
            return f"New content: {week}" if week else "New content"
        if obj.type == Type.MODULE_ADDED:
            return f"{week} is now available" if week else "A new week is now available"
        return obj.get_type_display()

    def get_body(self, obj):
        if obj.type == NotificationLog.NotificationType.CONTENT_REMINDER and obj.content_item:
            return obj.content_item.title
        return obj.module.title if obj.module else ""

    def get_url(self, obj):
        if obj.type == NotificationLog.NotificationType.SURVEY_PROMPT:
            return "/surveys"
        if obj.module:
            # The frontend module route is keyed by id, not week number.
            return f"/modules/{obj.module.id}/"
        return None
