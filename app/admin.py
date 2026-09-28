from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin

from .models import (
    User,
    Cohort,
    Enrollment,
    Module,
    ContentItem,
    Resource,
    ContentCompletion,
    ContentView,
    NotificationPreference,
    NotificationLog,
    PushSubscription,
    Survey,
    SurveyResponse,
    ForumThread,
    ForumPost,
)


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


@admin.register(Module)
class ModuleAdmin(admin.ModelAdmin):
    list_display = ("week_number", "title", "is_published", "created_at")
    list_filter = ("is_published",)
    search_fields = ("title",)
    inlines = [ContentItemInline]

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
    list_display = ("user", "email_enabled", "inapp_enabled", "push_denied", "reminder_time")
    list_filter = ("email_enabled", "push_denied")
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
admin.site.register(Resource)
admin.site.register(ContentCompletion)
admin.site.register(ContentView)
admin.site.register(NotificationLog)
admin.site.register(Survey)
admin.site.register(SurveyResponse)
admin.site.register(ForumThread)
admin.site.register(ForumPost)
