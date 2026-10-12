"""User accounts: sign-up, profiles, admin user management and password changes."""


from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from ..models import (
    User,
)

DISPOSABLE_EMAIL_DOMAINS = {
    "mailinator.com", "10minutemail.com", "guerrillamail.com",
    "tempmail.com", "yopmail.com", "trashmail.com",
}


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["email", "full_name", "password"]

    def validate_email(self, value):
        value = value.strip().lower()

        domain = value.rsplit("@", 1)[-1]
        if "." not in domain:
            raise serializers.ValidationError("Enter a valid email address.")
        if domain in DISPOSABLE_EMAIL_DOMAINS:
            raise serializers.ValidationError("Please use a permanent email address.")

        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        # Run AUTH_PASSWORD_VALIDATORS; the unsaved user lets the similarity
        # check compare the password against the email and name.
        candidate = User(email=attrs.get("email", ""), full_name=attrs.get("full_name", ""))
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(
            email=validated_data["email"],
            full_name=validated_data["full_name"],
            password=validated_data["password"],
        )


class UserDisplayNameSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "display_name"]
        read_only_fields = ["id"]


class AdminUserSerializer(serializers.ModelSerializer):
    # Their most recent enrollment, so the Users list needs no separate enrollments request.
    enrollment = serializers.SerializerMethodField()
    forum_banned = serializers.BooleanField(source="is_forum_banned", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "full_name",
            "display_name",
            "role",
            "auth_provider",
            "is_staff",
            "created_at",
            "enrollment",
            "forum_banned",
            "forum_banned_until",
        ]
        read_only_fields = fields

    def get_enrollment(self, obj):
        # UserProfileViewSet prefetches enrollments newest first; sorting here keeps any other caller correct too.
        enrollments = sorted(obj.enrollments.all(), key=lambda e: (e.enrolled_at, e.pk), reverse=True)
        if not enrollments:
            return None
        e = enrollments[0]
        return {"id": e.id, "cohort": e.cohort_id, "status": e.status, "enrolled_at": e.enrolled_at}


class AdminUserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name", "display_name", "role"]
        read_only_fields = ["id"]

    def validate_role(self, value):
        # Stops admins locking everyone out of the admin portal by mistake.
        request = self.context.get("request")
        if not self.instance or value == User.Role.ADMIN or self.instance.role != User.Role.ADMIN:
            return value
        if request and self.instance.pk == request.user.pk:
            raise serializers.ValidationError("You can't remove your own admin role.")
        if not User.objects.filter(role=User.Role.ADMIN).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError("There must always be at least one admin.")
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exclude(pk=self.instance.pk if self.instance else None).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        user = self.context["request"].user if "request" in self.context else None
        try:
            validate_password(value, user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value
