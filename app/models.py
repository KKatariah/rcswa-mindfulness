"""Database schema for the mindfulness training program.

The custom ``User`` model subclasses ``AbstractUser`` so Django's salted
password hashing and auth/permissions stack are inherited. ``username`` is
removed in favour of ``email`` as the unique identifier. SSO users who have
no local password get ``set_unusable_password()`` called in the manager —
there is no nullable password column.

Foreign keys use ``settings.AUTH_USER_MODEL`` rather than the ``User`` class
directly, the recommended pattern for pluggable user models.
"""

import datetime
import hashlib
import re
import secrets
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone

# Matches the video ID out of any common YouTube share/watch link shape:
# watch?v=, youtu.be/, /embed/, /shorts/, with or without extra query params
# (e.g. &t=30s, ?list=...) and with or without www./m./-nocookie.
_YOUTUBE_ID_RE = re.compile(
    r"youtube(?:-nocookie)?\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|v/)"
    r"(?P<id>[A-Za-z0-9_-]{11})"
    r"|youtu\.be/(?P<id2>[A-Za-z0-9_-]{11})"
)


def normalize_youtube_embed_url(url: str) -> str:
    """Rewrite a YouTube watch/share link to its canonical embeddable form
    (https://www.youtube.com/embed/{id}). Lets a non-technical admin paste
    whatever link they copied from YouTube — watch, youtu.be, shorts — and
    have it just work. An already-correct embed URL is left equivalent
    (idempotent); anything else that isn't a recognisable YouTube link
    (SoundCloud links included) is returned unchanged."""
    match = _YOUTUBE_ID_RE.search(url)
    if not match:
        return url
    video_id = match.group("id") or match.group("id2")
    return f"https://www.youtube.com/embed/{video_id}"


# A plain share link for a track or set, e.g. https://soundcloud.com/artist/track-name.
_SOUNDCLOUD_SHARE_RE = re.compile(r"^https?://(?:www\.)?soundcloud\.com/\S+$")
_SOUNDCLOUD_EMBED_PREFIX = "https://w.soundcloud.com/player/"


def normalize_soundcloud_embed_url(url: str) -> str:
    """Rewrite a plain SoundCloud share link (track or set) to the canonical
    embeddable player URL, which wraps the URL-encoded share link rather than
    needing SoundCloud's internal numeric track ID. An already-correct player
    embed URL is left unchanged; anything that isn't a recognisable SoundCloud
    share link (YouTube links included) is returned unchanged too."""
    if url.startswith(_SOUNDCLOUD_EMBED_PREFIX):
        return url
    if not _SOUNDCLOUD_SHARE_RE.match(url):
        return url
    return f"{_SOUNDCLOUD_EMBED_PREFIX}?url={quote(url, safe='')}"


# Users & Access
class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Email address is required.")
        # Emails are stored lower-case so sign-up and login ignore capitalisation.
        email = self.normalize_email(email).lower()
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
        extra_fields.setdefault("role", "admin")
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
    display_name = models.CharField(max_length=100, blank=True)
    auth_provider = models.CharField(max_length=50, default="local")
    provider_uid = models.CharField(max_length=255, blank=True, null=True)  # noqa: DJ01 (so flake8 linting ignores null=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.STUDENT)
    created_at = models.DateTimeField(auto_now_add=True)
    # Set once the user ticks "I agree" on the forum rules; null blocks forum access.
    forum_rules_accepted_at = models.DateTimeField(null=True, blank=True)
    # Wrong passwords in a row, and when a lock from too many of them ends (see app/lockout.py).
    failed_login_count = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    # Set when an admin bans the user from posting in the forum; they can still read it.
    # The ban ends at forum_banned_until, or lasts until lifted when that is null.
    forum_banned_at = models.DateTimeField(null=True, blank=True)
    forum_banned_until = models.DateTimeField(null=True, blank=True)

    @property
    def is_forum_banned(self):
        if self.forum_banned_at is None:
            return False
        return self.forum_banned_until is None or self.forum_banned_until > timezone.now()

    def save(self, *args, **kwargs):
        # Superusers are always app admins.
        if self.is_superuser:
            self.role = self.Role.ADMIN
        # Role is the source of truth for staff status.
        self.is_staff = self.role == self.Role.ADMIN
        super().save(*args, **kwargs)

    def __str__(self):
        return self.full_name or self.email


def _hash_token_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class AuthToken(models.Model):
    """API login token. One per signed-in device, expiring after a period without use
    (see app/authentication.py). Only a hash of the key is stored, so a copy of the
    database can't be used to log in."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="auth_tokens")
    key_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(auto_now_add=True)

    @classmethod
    def issue(cls, user):
        """Create a token for a new login and return its key (shown to the client once)."""
        key = secrets.token_hex(20)
        cls.objects.create(user=user, key_hash=_hash_token_key(key))
        return key

    @classmethod
    def find(cls, key):
        return cls.objects.select_related("user").filter(key_hash=_hash_token_key(key)).first()

    def __str__(self):
        return f"Token for {self.user} (last used {self.last_used:%Y-%m-%d})"


class UnknownEmailLockout(models.Model):
    """Wrong-password count and lock for an email with no account (see app/lockout.py).

    Real accounts keep theirs on the user; tracking unknown emails the same way means
    the lock message can't be used to tell which emails are registered. Only a keyed
    hash of the email is stored.
    """

    email_hash = models.CharField(max_length=64, unique=True)
    failed_login_count = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class Cohort(models.Model):
    name = models.CharField(max_length=150)
    year = models.PositiveIntegerField()
    start_date = models.DateField()
    end_date = models.DateField()

    def __str__(self):
        return f"{self.name} ({self.year})"


class Enrollment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
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
    summary = models.CharField(max_length=300, blank=True)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["week_number"]

    @property
    def week_label(self):
        """Display label for the week; week 0 is the programme introduction."""
        return "Introduction" if self.week_number == 0 else f"Week {self.week_number}"

    def __str__(self):
        return f"{self.week_label}: {self.title}"


class ContentItem(models.Model):
    class ContentType(models.TextChoices):
        VIDEO = "video", "Video"
        AUDIO = "audio", "Audio"
        # TODO(backlog): file-upload content type — needs a storage backend decision.

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
    provider = models.CharField(max_length=20, choices=Provider.choices, blank=True, default="")
    embed_url = models.URLField(blank=True, default="")
    display_order = models.PositiveSmallIntegerField(default=0)
    # Day within the module's week (0 = first day). Not used by daily reminders, which
    # go out every day; kept for a planned feature.
    day_offset = models.PositiveSmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["module", "display_order"]

    def save(self, *args, **kwargs):
        if self.embed_url:
            if self.provider == self.Provider.YOUTUBE:
                self.embed_url = normalize_youtube_embed_url(self.embed_url)
            elif self.provider == self.Provider.SOUNDCLOUD:
                self.embed_url = normalize_soundcloud_embed_url(self.embed_url)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class AdditionalResource(models.Model):
    """Books/documentaries/online programs shown on the Resources page (logged-in users only).

    A standalone, admin-managed reading list; not tied to a Module.
    """

    class Category(models.TextChoices):
        BOOK = "book", "Book"
        DOCUMENTARY = "documentary", "Documentary"
        ONLINE_PROGRAM = "online_program", "Online Program"

    category = models.CharField(max_length=20, choices=Category.choices, db_index=True)
    title = models.CharField(max_length=200)
    # Optional; used by books, generally blank for documentaries/online programs.
    author = models.CharField(max_length=200, blank=True, default="")
    url = models.URLField(blank=True, default="")
    cover_image = models.ImageField(upload_to="resource_covers/", null=True, blank=True)
    display_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "display_order", "id"]

    def __str__(self):
        return f"{self.get_category_display()}: {self.title}"


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


class ContentView(models.Model):
    """Auto-recorded the moment a user opens a module; distinct from ContentCompletion, which is manual."""

    # CASCADE: view records belong to the user.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="module_views",
    )
    # CASCADE: a view record is meaningless when its module is deleted.
    module = models.ForeignKey(
        Module,
        on_delete=models.CASCADE,
        related_name="views",
    )
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "module"],
                name="unique_view_user_module",
            ),
        ]

    def __str__(self):
        return f"{self.user} viewed {self.module}"


# Notifications

class NotificationPreference(models.Model):
    # CASCADE: preferences are owned by the user.
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preference",
    )

    inapp_enabled = models.BooleanField(default=True)

    # Default: 5pm Perth. Command filters by this hour when running on an hourly cron.
    reminder_time = models.TimeField(default=datetime.time(17, 0))

    # Set by the frontend when Notification.permission === 'denied'.
    # When True: no push attempted (user explicitly refused).
    push_denied = models.BooleanField(default=False)

    # Profile notification preferences
    daily_content_reminder = models.BooleanField(default=True)
    survey_unlocked_reminder = models.BooleanField(default=False)
    daily_survey_reminder = models.BooleanField(default=False)

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
        PUSH = "push", "Web Push"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        # Nothing to send to: notifications refused, or no registered device.
        SKIPPED = "skipped", "Skipped"
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
    # Set when the user marks it read in the in-app notifications panel.
    read_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.get_type_display()} to {self.user} ({self.status})"


class PushSubscription(models.Model):
    """Browser Push API subscription registered by the frontend.

    Frontend registration payload — POST /api/notifications/subscriptions/:
        {
            "endpoint": "<push service URL from PushSubscription.endpoint>",
            "p256dh":   "<base64url from PushSubscription.getKey('p256dh')>",
            "auth":     "<base64url from PushSubscription.getKey('auth')>"
        }
    user_agent is extracted from the User-Agent request header server-side.
    The VAPID public key for pushManager.subscribe() is at GET /api/notifications/vapid-public-key/.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    # Globally unique per browser/device. Upsert key on registration.
    endpoint = models.TextField(unique=True)
    p256dh = models.TextField()
    auth = models.TextField()
    user_agent = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Updated on every re-registration (e.g. after a service worker update).
    last_seen = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Push sub for {self.user} ({self.endpoint[:60]}…)"


# Surveys

class SurveyType(models.TextChoices):
    INTAKE = "intake", "Intake"
    WEEKLY = "weekly", "Weekly"
    END = "end", "End"
    FOLLOWUP = "followup", "Follow-up"


class Survey(models.Model):
    # Backward-compat alias: Survey.SurveyType.WEEKLY continues to work everywhere.
    SurveyType = SurveyType

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
        if self.type == SurveyType.WEEKLY and self.module_id is None:
            raise ValidationError({"module": "A weekly survey must be linked to a module."})

    def __str__(self):
        return f"{self.title} ({self.code})"

    class Meta:
        ordering = ["module__week_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["module"],
                condition=Q(type=SurveyType.WEEKLY),
                name="unique_weekly_survey_per_module",
            ),
        ]


class SurveyResponse(models.Model):
    # CASCADE: responses belong to the user.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="survey_responses",
    )
    # PROTECT: responses are research data; a survey that has any can't be deleted.
    survey = models.ForeignKey(
        Survey,
        on_delete=models.PROTECT,
        related_name="responses",
    )
    answers = models.JSONField()
    # The survey's questions as the participant saw them, so answers given before an
    # admin edits, reorders or removes a question can be flagged against the new version.
    questions = models.JSONField(default=list)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "survey"], name="unique_survey_response_user_survey"
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.questions and self.survey_id:
            self.questions = self.survey.questions or []
        super().save(*args, **kwargs)

    def question_changes(self, current=None):
        """How the survey's questions differ from the ones this participant answered.

        Returns {question_id: {"status": ..., "previous": question or None}} where status is
        "edited" (answered, but the question has changed since), "removed" (answered, but no
        longer in the survey) or "added" (added after this response, so never asked).
        Section headings are ignored: they introduce a question rather than change it.
        """
        if not self.questions:
            return {}  # No record of what was asked; nothing to compare against.
        current = self.survey.questions if current is None else current

        def definition(q):
            return {k: v for k, v in q.items() if k != "section"}

        before = {q.get("id"): q for q in self.questions if isinstance(q, dict)}
        now = {q.get("id"): q for q in current or [] if isinstance(q, dict)}
        answered = self.answers or {}
        changes = {}
        for qid, old in before.items():
            if qid not in answered:
                continue
            if qid not in now:
                changes[qid] = {"status": "removed", "previous": old}
            elif definition(old) != definition(now[qid]):
                changes[qid] = {"status": "edited", "previous": old}
        for qid in now.keys() - before.keys():
            changes[qid] = {"status": "added", "previous": None}
        return changes

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
    is_pinned = models.BooleanField(default=False)
    pin_order = models.PositiveIntegerField(default=0, db_index=True)
    opened_by = models.OneToOneField(
        "ForumPost",
        on_delete=models.SET_NULL,
        related_name="opened_thread",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            # Both null (general thread) is valid; only rejected when BOTH are set.
            models.CheckConstraint(
                condition=~Q(module__isnull=False, content_item__isnull=False),
                name="forum_thread_at_most_one_context",
            ),
        ]

    def reorder_pinned_threads(self, requested_order=None):
        with transaction.atomic():
            thread = type(self).objects.select_for_update().get(pk=self.pk)
            pinned_threads = list(
                type(self).objects.select_for_update()
                .filter(is_pinned=True)
                .exclude(pk=thread.pk)
                .order_by("pin_order", "created_at", "pk")
            )

            if thread.is_pinned:
                position = min(
                    max(requested_order or 1, 1),
                    len(pinned_threads) + 1,
                )
                pinned_threads.insert(position - 1, thread)
            else:
                thread.pin_order = 0
                thread.save(update_fields=["pin_order"])

            for order, pinned_thread in enumerate(pinned_threads, start=1):
                if pinned_thread.pin_order != order:
                    type(self).objects.filter(pk=pinned_thread.pk).update(
                        pin_order=order
                    )
                    pinned_thread.pin_order = order

            self.refresh_from_db(fields=["is_pinned", "pin_order"])

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
    is_head_post = models.BooleanField(default=False)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    # Soft-delete flag. delete() is NOT overridden per spec. Deleting a thread's opening
    # post removes the whole thread from the forum; admins can see and restore either.
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    # The author, or the admin who removed it. SET_NULL: the record outlives the account.
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["created_at"]

    def soft_delete(self, by):
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.deleted_by = by
        self.save(update_fields=["is_deleted", "deleted_at", "deleted_by"])

    def restore(self):
        self.is_deleted = False
        self.deleted_at = None
        self.deleted_by = None
        self.save(update_fields=["is_deleted", "deleted_at", "deleted_by"])

    def __str__(self):
        return f"Post by {self.author} in {self.thread}"


class ForumFlag(models.Model):
    """A report that a post breaks the forum rules, waiting for an admin to act on it."""

    class Resolution(models.TextChoices):
        DISMISSED = "dismissed", "Dismissed"
        HIDDEN = "hidden", "Post hidden"
        BANNED = "banned", "Author banned"

    post = models.ForeignKey(ForumPost, on_delete=models.CASCADE, related_name="flags")
    # SET_NULL: the report stays in the moderation history if the reporter's account goes.
    flagged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="forum_flags",
        null=True,
    )
    reason = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Null while the report is open.
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
    )
    resolution = models.CharField(max_length=10, choices=Resolution.choices, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # One open report per person per post; they can report it again once it's been dealt with.
            models.UniqueConstraint(
                fields=["post", "flagged_by"],
                condition=Q(resolved_at__isnull=True),
                name="forum_flag_one_open_per_reporter",
            ),
        ]

    def __str__(self):
        return f"Flag on post {self.post_id} by {self.flagged_by}"
