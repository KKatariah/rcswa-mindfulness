"""Cohorts and enrollments (admin)."""


from django.utils import timezone
from rest_framework import serializers

from ..models import (
    Cohort,
    Enrollment,
)


class CohortSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cohort
        fields = ["id", "name", "year", "start_date", "end_date"]

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end <= start:
            raise serializers.ValidationError({"end_date": "end_date must be after start_date."})
        instance = self.instance
        if (
            instance
            and "start_date" in attrs
            and attrs["start_date"] != instance.start_date
            and instance.start_date <= timezone.localdate()
            and instance.enrollments.filter(status=Enrollment.Status.ACTIVE).exists()
        ):
            # Moving the start date would shift every member's unlock dates and
            # could re-lock weeks they have already opened.
            raise serializers.ValidationError(
                {"start_date": "This cohort has started and has active students, so its start date can't change."}
            )
        return attrs


class EnrollmentSerializer(serializers.ModelSerializer):
    user_email = serializers.SerializerMethodField()
    user_full_name = serializers.SerializerMethodField()

    class Meta:
        model = Enrollment
        fields = ["id", "user", "user_email", "user_full_name", "cohort", "status", "enrolled_at"]
        read_only_fields = ["enrolled_at"]

    def validate(self, attrs):
        # One active enrollment per user: unlock dates, reminders and notices all
        # assume a single cohort. Move a user by changing the cohort instead.
        user = attrs.get("user", getattr(self.instance, "user", None))
        new_status = attrs.get("status", getattr(self.instance, "status", Enrollment.Status.ACTIVE))
        if user and new_status == Enrollment.Status.ACTIVE:
            others = Enrollment.objects.filter(user=user, status=Enrollment.Status.ACTIVE)
            if self.instance:
                others = others.exclude(pk=self.instance.pk)
            if others.exists():
                raise serializers.ValidationError(
                    {"status": "This user is already active in another cohort. Move or withdraw that enrollment first."}
                )
        return attrs

    def get_user_email(self, obj):
        return obj.user.email if obj.user else None

    def get_user_full_name(self, obj):
        return obj.user.full_name if obj.user else None
