"""Database schema for the mindfulness training program.

The custom ``User`` model subclasses ``AbstractUser`` so we inherit Django's
built-in, salted password hashing (``set_password`` / ``check_password``) and
the full auth/permissions stack. Because of the custom user model,
``AUTH_USER_MODEL = 'app.User'`` must be set in settings before the first
migration is created.

Foreign keys reference ``settings.AUTH_USER_MODEL`` rather than the ``User``
class directly — this is the recommended pattern for pluggable user models.
"""

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """A program participant or administrator.

    Extends Django's ``AbstractUser`` (username, email, password hash, names,
    is_staff/is_active, etc.) with the fields this program needs.
    """

    class Role(models.TextChoices):
        STUDENT = "student", "Student"
        ADMIN = "admin", "Admin"

    phone_number = models.CharField(max_length=20, blank=True)
    role = models.CharField(
        max_length=10,
        choices=Role.choices,
        default=Role.STUDENT,
    )
    university = models.CharField(max_length=150, blank=True)
    year_of_study = models.PositiveSmallIntegerField(null=True, blank=True)

    def __str__(self):
        return self.get_full_name() or self.username


class Cohort(models.Model):
    """One run of the program, typically one per calendar year."""

    name = models.CharField(max_length=150)
    year = models.PositiveIntegerField()
    start_date = models.DateField()

    def __str__(self):
        return f"{self.name} ({self.year})"


class Enrollment(models.Model):
    """Links a user to the cohort they are taking part in."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        WITHDRAWN = "withdrawn", "Withdrawn"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="enrollments",
    )
    cohort = models.ForeignKey(
        Cohort,
        on_delete=models.CASCADE,
        related_name="enrollments",
    )
    start_date = models.DateField()
    current_week = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(
        max_length=12,
        choices=Status.choices,
        default=Status.ACTIVE,
    )

    class Meta:
        unique_together = ("user", "cohort")

    def __str__(self):
        return f"{self.user} in {self.cohort}"


class Module(models.Model):
    """A weekly module of the program (weeks 1–8)."""

    week_number = models.PositiveSmallIntegerField(unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    is_published = models.BooleanField(default=False)

    class Meta:
        ordering = ["week_number"]

    def __str__(self):
        return f"Week {self.week_number}: {self.title}"


class ContentItem(models.Model):
    """An embeddable piece of content (video or guided meditation)."""

    class ContentType(models.TextChoices):
        VIDEO = "video", "Video"
        MEDITATION = "meditation", "Meditation"

    module = models.ForeignKey(
        Module,
        on_delete=models.CASCADE,
        related_name="content_items",
    )
    type = models.CharField(max_length=12, choices=ContentType.choices)
    title = models.CharField(max_length=200)
    embed_url = models.URLField()
    provider = models.CharField(max_length=50, blank=True)

    def __str__(self):
        return self.title


class Resource(models.Model):
    """A supplementary resource (link, PDF, etc.), optionally tied to a module."""

    class ResourceType(models.TextChoices):
        LINK = "link", "Link"
        DOCUMENT = "document", "Document"
        ARTICLE = "article", "Article"

    module = models.ForeignKey(
        Module,
        on_delete=models.SET_NULL,
        related_name="resources",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=200)
    url = models.URLField()
    resource_type = models.CharField(
        max_length=20,
        choices=ResourceType.choices,
        default=ResourceType.LINK,
    )

    def __str__(self):
        return self.title


class ContentCompletion(models.Model):
    """Records that a user has completed a content item (progress tick)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="content_completions",
    )
    content_item = models.ForeignKey(
        ContentItem,
        on_delete=models.CASCADE,
        related_name="completions",
    )
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "content_item")

    def __str__(self):
        return f"{self.user} completed {self.content_item}"


class PracticeLog(models.Model):
    """A daily self-reported record of whether the user practised."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="practice_logs",
    )
    practice_date = models.DateField()
    practiced = models.BooleanField(default=False)
    duration_min = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        unique_together = ("user", "practice_date")

    def __str__(self):
        return f"{self.user} on {self.practice_date}"


class Survey(models.Model):
    """A questionnaire administered at some point in the program."""

    class SurveyType(models.TextChoices):
        INTAKE = "intake", "Intake"
        WEEKLY = "weekly", "Weekly"
        OUTCOME = "outcome", "Outcome"
        FOLLOWUP = "followup", "Follow-up"

    code = models.CharField(max_length=50, unique=True)
    title = models.CharField(max_length=200)
    type = models.CharField(max_length=12, choices=SurveyType.choices)

    def __str__(self):
        return f"{self.title} ({self.code})"


class Question(models.Model):
    """A single question belonging to a survey."""

    class ResponseType(models.TextChoices):
        SCALE = "scale", "Scale"
        TEXT = "text", "Text"
        BOOLEAN = "boolean", "Boolean"

    survey = models.ForeignKey(
        Survey,
        on_delete=models.CASCADE,
        related_name="questions",
    )
    text = models.TextField()
    response_type = models.CharField(
        max_length=12,
        choices=ResponseType.choices,
    )
    scale_min = models.IntegerField(null=True, blank=True)
    scale_max = models.IntegerField(null=True, blank=True)

    def __str__(self):
        return self.text[:60]


class SurveyResponse(models.Model):
    """One submission of a survey by a user."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="survey_responses",
    )
    survey = models.ForeignKey(
        Survey,
        on_delete=models.CASCADE,
        related_name="responses",
    )
    week_number = models.PositiveSmallIntegerField(null=True, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user} — {self.survey}"


class Answer(models.Model):
    """A single answer to a question within a survey response."""

    survey_response = models.ForeignKey(
        SurveyResponse,
        on_delete=models.CASCADE,
        related_name="answers",
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        related_name="answers",
    )
    value_numeric = models.FloatField(null=True, blank=True)
    value_text = models.TextField(blank=True)

    def __str__(self):
        return f"Answer to {self.question}"


class JournalEntry(models.Model):
    """A weekly reflection written by the user."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="journal_entries",
    )
    week_number = models.PositiveSmallIntegerField()
    feeling_text = models.TextField(blank=True)
    experience_text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user} — week {self.week_number}"


class NotificationPreference(models.Model):
    """Per-user notification settings."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preference",
    )
    email_enabled = models.BooleanField(default=True)
    sms_enabled = models.BooleanField(default=False)
    reminder_time = models.TimeField(null=True, blank=True)

    def __str__(self):
        return f"Preferences for {self.user}"


class NotificationLog(models.Model):
    """A record of a notification that was (or will be) sent to a user."""

    class Channel(models.TextChoices):
        EMAIL = "email", "Email"
        SMS = "sms", "SMS"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_logs",
    )
    channel = models.CharField(max_length=10, choices=Channel.choices)
    scheduled_for = models.DateTimeField()
    sent_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.PENDING,
    )

    def __str__(self):
        return f"{self.channel} to {self.user} ({self.status})"


class ForumThread(models.Model):
    """A discussion thread, optionally attached to a module."""

    module = models.ForeignKey(
        Module,
        on_delete=models.SET_NULL,
        related_name="threads",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=200)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="threads_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class ForumPost(models.Model):
    """A post within a thread; may be a reply to another post."""

    thread = models.ForeignKey(
        ForumThread,
        on_delete=models.CASCADE,
        related_name="posts",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="forum_posts",
    )
    parent_post = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        related_name="replies",
        null=True,
        blank=True,
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Post by {self.author} in {self.thread}"


class BuddyPair(models.Model):
    """A pairing of two users within a cohort for peer support."""

    cohort = models.ForeignKey(
        Cohort,
        on_delete=models.CASCADE,
        related_name="buddy_pairs",
    )
    user_a = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="buddy_pairs_as_a",
    )
    user_b = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="buddy_pairs_as_b",
    )

    def __str__(self):
        return f"{self.user_a} & {self.user_b}"
