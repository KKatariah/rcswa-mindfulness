"""Push subscriptions and notification preferences."""


from rest_framework import serializers

from ..models import (
    NotificationPreference,
    PushSubscription,
)


class PushSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushSubscription
        fields = ["id", "endpoint", "p256dh", "auth", "created_at", "last_seen"]
        read_only_fields = ["id", "created_at", "last_seen"]
        extra_kwargs = {
            "endpoint": {"validators": []},
        }


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
