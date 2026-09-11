from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from app.views import (
    CohortViewSet,
    ContentCompletionViewSet,
    ContentItemViewSet,
    EnrollmentViewSet,
    ForumPostViewSet,
    ForumThreadViewSet,
    ModuleViewSet,
    SurveyResponseViewSet,
    SurveyViewSet,
    UserProfileViewSet,
)

router = DefaultRouter()
router.register("modules", ModuleViewSet, basename="module")
router.register("content-items", ContentItemViewSet, basename="content-item")
router.register("progress", ContentCompletionViewSet, basename="progress")
router.register("forum/threads", ForumThreadViewSet, basename="forum-thread")
router.register("forum/posts", ForumPostViewSet, basename="forum-post")
router.register("users", UserProfileViewSet, basename="user")
router.register("surveys", SurveyViewSet, basename="survey")
router.register("survey-responses", SurveyResponseViewSet, basename="survey-response")
router.register("cohorts", CohortViewSet, basename="cohort")
router.register("enrollments", EnrollmentViewSet, basename="enrollment")

urlpatterns = [
    path('admin/', admin.site.urls),
    path('__reload__/', include('django_browser_reload.urls')),
    path('app/', include('app.urls')),
    path('api/', include('app.api_urls')),
    path('api/', include(router.urls)),
]
