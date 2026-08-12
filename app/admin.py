from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

#import all the models from models.py
from .models import (
    User,
    Cohort,
    Enrollment,
    Module,
    ContentItem,
    Resource,
    ContentCompletion,
    NotificationPreference,
    NotificationLog,
    Survey,
    SurveyResponse,
    ForumThread,
    ForumPost,
)


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = (
        "email",
        "full_name",
        "role",
        "auth_provider",
        "is_staff",
        "is_active",
    )

    list_filter = (
        "role",
        "is_staff",
        "is_active",
    )

    search_fields = (
        "email",
        "full_name",
    )
    ordering = ("email",)


#register all the models
admin.site.register(Cohort)
admin.site.register(Enrollment)
admin.site.register(Module)
admin.site.register(ContentItem)
admin.site.register(Resource)
admin.site.register(ContentCompletion)
admin.site.register(NotificationPreference)
admin.site.register(NotificationLog)
admin.site.register(Survey)
admin.site.register(SurveyResponse)
admin.site.register(ForumThread)
admin.site.register(ForumPost)