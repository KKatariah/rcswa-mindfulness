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
    PracticeLog,
    Survey,
    Question,
    SurveyResponse,
    Answer,
    JournalEntry,
    NotificationPreference,
    NotificationLog,
    ForumThread,
    ForumPost,
    BuddyPair,
)


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ("username", "email", "first_name", "last_name", "role", "university", "is_staff", "is_active")
    list_filter = ("role", "is_staff", "is_active")
    search_fields = ("username", "email", "first_name", "last_name")

#register all the models
admin.site.register(Cohort)
admin.site.register(Enrollment)
admin.site.register(Module)
admin.site.register(ContentItem)
admin.site.register(Resource)
admin.site.register(ContentCompletion)
admin.site.register(PracticeLog)
admin.site.register(Survey)
admin.site.register(Question)
admin.site.register(SurveyResponse)
admin.site.register(Answer)
admin.site.register(JournalEntry)
admin.site.register(NotificationPreference)
admin.site.register(NotificationLog)
admin.site.register(ForumThread)
admin.site.register(ForumPost)
admin.site.register(BuddyPair)
