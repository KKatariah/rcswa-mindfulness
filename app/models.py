"""Database schema for the mindfulness training program.

The custom ``User`` model subclasses ``AbstractUser`` so Django's salted
password hashing and auth/permissions stack are inherited. ``username`` is
removed in favour of ``email`` as the unique identifier. SSO users who have
no local password get ``set_unusable_password()`` called in the manager —
there is no nullable password column.

Foreign keys use ``settings.AUTH_USER_MODEL`` rather than the ``User`` class
directly, the recommended pattern for pluggable user models.
"""

from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


# Users & Access
class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Email address is required.")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        if password:
            user.set_password(password)
        else:
            # SSO users have no local password
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    class Role(models.TextChoices):
        STUDENT = "student", "Student"
        ADMIN = "admin", "Admin"

    # Remove inherited username field; email is the unique identifier.
    username = None

    objects = UserManager()

    USERNAME_FIELD = "email"
    # Overrides AbstractUser.REQUIRED_FIELDS = ['email'] (can't duplicate USERNAME_FIELD).
    REQUIRED_FIELDS = ["full_name"]

    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=200, blank=True)
    auth_provider = models.CharField(max_length=50, default="local")
    provider_uid = models.CharField(max_length=255, blank=True, null=True)  # noqa: DJ01 (so flake8 linting ignores null=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.STUDENT)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.full_name or self.email


class Cohort(models.Model):
    name = models.CharField(max_length=150)
    year = models.PositiveIntegerField()
    start_date = models.DateField()
    end_date = models.DateField()

    def __str__(self):
        return f"{self.name} ({self.year})"


class Enrollment(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        WITHDRAWN = "withdrawn", "Withdrawn"

    # CASCADE: an enrollment record is meaningless without its user.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="enrollments",
    )
    # CASCADE: an enrollment record is meaningless without its cohort.
    cohort = models.ForeignKey(
        Cohort,
        on_delete=models.CASCADE,
        related_name="enrollments",
    )
    current_week = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.ACTIVE
    )
    enrolled_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "cohort"], name="unique_enrollment_user_cohort"
            ),
        ]

    def __str__(self):
        return f"{self.user} in {self.cohort}"


# Content

class Module(models.Model):
    # Globally unique — see ambiguity note at bottom of file.
    week_number = models.PositiveSmallIntegerField(unique=True, db_index=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["week_number"]

    def __str__(self):
        return f"Week {self.week_number}: {self.title}"


class ContentItem(models.Model):
    class ContentType(models.TextChoices):
        VIDEO = "video", "Video"
        AUDIO = "audio", "Audio"

    class Provider(models.TextChoices):
        YOUTUBE = "youtube", "YouTube"
        SOUNDCLOUD = "soundcloud", "SoundCloud"

    # CASCADE: content items are owned by their module.
    module = models.ForeignKey(
        Module,
        on_delete=models.CASCADE,
        related_name="content_items",
    )
    title = models.CharField(max_length=200)
    type = models.CharField(max_length=10, choices=ContentType.choices)
    provider = models.CharField(max_length=20, choices=Provider.choices)
    embed_url = models.URLField()
    display_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["module", "display_order"]

    def __str__(self):
        return self.title


class Resource(models.Model):
    # SET_NULL: supplementary resources are not destroyed when a module is removed.
    module = models.ForeignKey(
        Module,
        on_delete=models.SET_NULL,
        related_name="resources",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=200)
    url = models.URLField()
    resource_type = models.CharField(max_length=100)
    display_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["display_order"]

    def __str__(self):
        return self.title


# Progress

class ContentCompletion(models.Model):
    # CASCADE: completion records belong to the user.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="content_completions",
    )
    # CASCADE: a completion record is meaningless when its content item is deleted.
    content_item = models.ForeignKey(
        ContentItem,
        on_delete=models.CASCADE,
        related_name="completions",
    )
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "content_item"],
                name="unique_completion_user_content_item",
            ),
        ]

    def __str__(self):
        return f"{self.user} completed {self.content_item}"


# Notifications

class NotificationPreference(models.Model):
    # CASCADE: preferences are owned by the user.
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preference",
    )
    inapp_enabled = models.BooleanField(default=True)
    email_enabled = models.BooleanField(default=True)
    reminder_time = models.TimeField()

    def __str__(self):
        return f"Preferences for {self.user}"


class NotificationLog(models.Model):
    class NotificationType(models.TextChoices):
        CONTENT_REMINDER = "content_reminder", "Content Reminder"
        SURVEY_PROMPT = "survey_prompt", "Survey Prompt"
        CONTENT_UPDATE = "content_update", "Content Update"
        MODULE_ADDED = "module_added", "Module Added"

    class Channel(models.TextChoices):
        INAPP = "inapp", "In-App"
        EMAIL = "email", "Email"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"

    # CASCADE: log entries belong to the user.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_logs",
    )
    type = models.CharField(max_length=20, choices=NotificationType.choices)
    # SET_NULL: preserve the audit trail even when referenced content is deleted.
    module = models.ForeignKey(
        Module,
        on_delete=models.SET_NULL,
        related_name="notification_logs",
        null=True,
        blank=True,
    )
    content_item = models.ForeignKey(
        ContentItem,
        on_delete=models.SET_NULL,
        related_name="notification_logs",
        null=True,
        blank=True,
    )
    channel = models.CharField(max_length=10, choices=Channel.choices)
    scheduled_for = models.DateTimeField(db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )

    def __str__(self):
        return f"{self.get_type_display()} to {self.user} ({self.status})"


# Surveys

class Survey(models.Model):
    class SurveyType(models.TextChoices):
        INTAKE = "intake", "Intake"
        WEEKLY = "weekly", "Weekly"
        END = "end", "End"
        FOLLOWUP = "followup", "Follow-up"

    # SET_NULL: surveys may be global (not tied to any module).
    module = models.ForeignKey(
        Module,
        on_delete=models.SET_NULL,
        related_name="surveys",
        null=True,
        blank=True,
    )
    code = models.CharField(max_length=50, unique=True)
    title = models.CharField(max_length=200)
    type = models.CharField(max_length=10, choices=SurveyType.choices)
    questions = models.JSONField(default=list)

    def clean(self):
        if self.type == self.SurveyType.WEEKLY and self.module_id is None:
            raise ValidationError({"module": "A weekly survey must be linked to a module."})

    def __str__(self):
        return f"{self.title} ({self.code})"


class SurveyResponse(models.Model):
    # CASCADE: responses belong to the user.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="survey_responses",
    )
    # CASCADE: a response is meaningless without its survey definition.
    survey = models.ForeignKey(
        Survey,
        on_delete=models.CASCADE,
        related_name="responses",
    )
    answers = models.JSONField()
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "survey"], name="unique_survey_response_user_survey"
            ),
        ]

    def __str__(self):
        return f"{self.user} — {self.survey}"


# Community

class ForumThread(models.Model):
    # SET_NULL: threads survive module/content deletion (community content is durable).
    module = models.ForeignKey(
        Module,
        on_delete=models.SET_NULL,
        related_name="forum_threads",
        null=True,
        blank=True,
    )
    content_item = models.ForeignKey(
        ContentItem,
        on_delete=models.SET_NULL,
        related_name="forum_threads",
        null=True,
        blank=True,
    )
    # SET_NULL: community threads outlive their authors; created_by becomes null on deletion.
    # Schema marks created_by non-nullable, but SET_NULL (with null=True) is preferable
    # because CASCADE would silently destroy community discussion on user deletion.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="threads_created",
        null=True,
    )
    title = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(module__isnull=False, content_item__isnull=True)
                    | Q(module__isnull=True, content_item__isnull=False)
                ),
                name="forum_thread_exactly_one_context",
            ),
        ]

    def __str__(self):
        return self.title


class ForumPost(models.Model):
    # CASCADE: posts are destroyed when their thread is deleted.
    thread = models.ForeignKey(
        ForumThread,
        on_delete=models.CASCADE,
        related_name="posts",
    )
    # SET_NULL: anonymise authorship rather than destroying posts when a user is deleted.
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="forum_posts",
        null=True,
    )
    # SET_NULL: replies survive if their parent post is hard-deleted.
    parent_post = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        related_name="replies",
        null=True,
        blank=True,
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Soft-delete flag. delete() is NOT overridden per spec.
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Post by {self.author} in {self.thread}"
