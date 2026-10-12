from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin
from django.db import transaction
from rest_framework import serializers

from .models import (
    User,
    Cohort,
    Enrollment,
    Module,
    ContentItem,
    AdditionalResource,
    ContentCompletion,
    ContentView,
    NotificationPreference,
    NotificationLog,
    PushSubscription,
    Survey,
    SurveyResponse,
    ForumThread,
    ForumPost,
    ForumRulesRevision,
)
from .serializers import validate_survey_questions


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ("email", "full_name", "role", "auth_provider", "is_staff", "is_active")
    list_filter = ("role", "is_staff", "is_active")
    search_fields = ("email", "full_name")
    ordering = ("email",)

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("full_name", "display_name", "role", "auth_provider", "provider_uid")}),
        ("Permissions", {
            "fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions"),
        }),
        ("Important dates", {"fields": ("last_login", "created_at")}),
    )

    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "full_name", "password1", "password2", "role"),
        }),
    )

    readonly_fields = ("created_at",)


class ContentItemInline(admin.TabularInline):
    model = ContentItem
    extra = 0
    fields = ("title", "type", "provider", "embed_url", "display_order", "day_offset")
    ordering = ("display_order",)


class SurveyInline(admin.TabularInline):
    model = Survey
    extra = 0
    fields = ("code", "title", "type", "question_count")
    readonly_fields = ("code", "type", "question_count")
    show_change_link = True

    @admin.display(description="Questions")
    def question_count(self, obj):
        return len(obj.questions) if obj.questions else 0


class ForumThreadAdminForm(forms.ModelForm):
    pin_order = forms.TypedChoiceField(
        choices=(),
        coerce=int,
        empty_value=0,
        required=False,
    )

    class Meta:
        model = ForumThread
        fields = ("module", "content_item", "cohort", "created_by", "title", "is_pinned", "pin_order", "opened_by")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        max_pinned = settings.FORUM_MAX_PINNED_THREADS
        pinned_threads = ForumThread.pinned_in_cohort(self.instance.cohort_id)
        if self.instance.pk:
            pinned_threads = pinned_threads.exclude(pk=self.instance.pk)
        max_position = min(pinned_threads.count() + 1, max_pinned)
        self.fields["pin_order"].choices = [
            ("", "---------"),
            *((order, str(order)) for order in range(1, max_position + 1)),
        ]
        if not self.instance.pin_order:
            self.initial["pin_order"] = ""

    def clean(self):
        cleaned_data = super().clean()
        if not cleaned_data.get("is_pinned"):
            if "pin_order" in cleaned_data and cleaned_data["pin_order"] != 0:
                self.add_error(
                    "pin_order",
                    "You must select is_pinned to select a pin_order value.",
                )
            elif "pin_order" in cleaned_data:
                cleaned_data["pin_order"] = 0
        else:
            cohort = cleaned_data.get("cohort")
            pinned_threads = ForumThread.pinned_in_cohort(cohort.pk if cohort else None)
            if self.instance.pk:
                pinned_threads = pinned_threads.exclude(pk=self.instance.pk)
            if pinned_threads.count() >= settings.FORUM_MAX_PINNED_THREADS:
                self.add_error(
                    "is_pinned",
                    f"You have already reached the maximum of "
                    f"{settings.FORUM_MAX_PINNED_THREADS} pinned threads.",
                )
            if "pin_order" in cleaned_data and not cleaned_data["pin_order"]:
                self.add_error("pin_order", "Choose an order for a pinned thread.")
        return cleaned_data


@admin.register(ForumThread)
class ForumThreadAdmin(admin.ModelAdmin):
    form = ForumThreadAdminForm
    list_display = ("title", "cohort", "created_by", "is_pinned", "created_at")
    list_filter = ("cohort", "is_pinned")
    list_select_related = ("cohort", "created_by")

    @transaction.atomic
    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        obj.reorder_pinned_threads(obj.pin_order if obj.is_pinned else None)


@admin.register(Module)
class ModuleAdmin(admin.ModelAdmin):
    list_display = ("week_number", "title", "is_published", "created_at")
    list_filter = ("is_published",)
    search_fields = ("title",)
    inlines = [ContentItemInline, SurveyInline]

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        # Warn if two audio items in this module share a day_offset — the command
        # would send both but only one reminder per user per day is meaningful.
        module = form.instance
        offsets = list(
            ContentItem.objects
            .filter(module=module, type=ContentItem.ContentType.AUDIO)
            .exclude(day_offset__isnull=True)
            .values_list("day_offset", flat=True)
        )
        seen: set = set()
        duplicates = {o for o in offsets if o in seen or seen.add(o)}
        if duplicates:
            self.message_user(
                request,
                f"Warning: multiple audio items in this module share day_offset "
                f"value(s) {sorted(duplicates)}. Only one reminder fires per user per day.",
                level=messages.WARNING,
            )


@admin.register(ContentItem)
class ContentItemAdmin(admin.ModelAdmin):
    list_display = ("title", "module", "type", "display_order", "day_offset", "scheduled_status")
    list_filter = ("type", "module", ("day_offset", admin.EmptyFieldListFilter))
    search_fields = ("title",)
    ordering = ("module", "display_order")

    @admin.display(description="Scheduled?", boolean=True)
    def scheduled_status(self, obj):
        return obj.day_offset is not None

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if obj.type == ContentItem.ContentType.AUDIO and obj.day_offset is not None:
            duplicate = (
                ContentItem.objects
                .filter(module=obj.module, type=ContentItem.ContentType.AUDIO, day_offset=obj.day_offset)
                .exclude(pk=obj.pk)
                .exists()
            )
            if duplicate:
                self.message_user(
                    request,
                    f"Warning: another audio item in '{obj.module}' already uses "
                    f"day_offset={obj.day_offset}. Only one reminder will fire per user on that day.",
                    level=messages.WARNING,
                )


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "inapp_enabled", "push_denied", "reminder_time")
    list_filter = ("push_denied",)
    search_fields = ("user__email",)


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "endpoint_truncated", "user_agent", "created_at", "last_seen")
    list_filter = ("user",)
    search_fields = ("user__email", "endpoint")
    readonly_fields = ("endpoint", "p256dh", "auth", "user_agent", "created_at", "last_seen")

    @admin.display(description="Endpoint")
    def endpoint_truncated(self, obj):
        return obj.endpoint[:80] + "…" if len(obj.endpoint) > 80 else obj.endpoint


admin.site.register(Cohort)
admin.site.register(Enrollment)
admin.site.register(AdditionalResource)
admin.site.register(ContentCompletion)
admin.site.register(ContentView)
admin.site.register(NotificationLog)
admin.site.register(SurveyResponse)
admin.site.register(ForumRulesRevision)


# ── Survey admin ──────────────────────────────────────────────────────────────

class SurveyAdminForm(forms.ModelForm):
    class Meta:
        model = Survey
        fields = ["module", "code", "title", "type", "questions"]

    def clean_questions(self):
        # Same rules as the admin API, so questions can't be saved here in a shape the app rejects.
        questions = self.cleaned_data.get("questions")
        try:
            validate_survey_questions(questions)
        except serializers.ValidationError as exc:
            raise forms.ValidationError(exc.detail)
        return questions


@admin.register(Survey)
class SurveyAdmin(admin.ModelAdmin):
    form = SurveyAdminForm
    list_display = ("code", "title", "module", "type", "question_count")
    list_filter = ("type", "module")
    search_fields = ("code", "title")
    ordering = ("module__week_number", "type")

    @admin.display(description="Questions")
    def question_count(self, obj):
        return len(obj.questions) if obj.questions else 0


@admin.register(ForumPost)
class ForumPostAdmin(admin.ModelAdmin):
    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "parent_post":
            kwargs["queryset"] = ForumPost.objects.filter(is_head_post=True)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)
