from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from app.views import (
    AdditionalResourceViewSet,
    CohortViewSet,
    ContentCompletionViewSet,
    ContentItemViewSet,
    EnrollmentViewSet,
    ForumPostViewSet,
    ForumThreadViewSet,
    ModuleViewSet,
    NotificationPreferenceViewSet,
    PushSubscriptionViewSet,
    SurveyResponseViewSet,
    SurveyViewSet,
    vapid_public_key_view,
    ContentViewViewSet,
    UserProfileViewSet,
)

router = DefaultRouter()
router.register("modules", ModuleViewSet, basename="module")
router.register("content-items", ContentItemViewSet, basename="content-item")
router.register("progress", ContentCompletionViewSet, basename="progress")
router.register("content-views", ContentViewViewSet, basename="content-view")
router.register("forum/threads", ForumThreadViewSet, basename="forum-thread")
router.register("forum/posts", ForumPostViewSet, basename="forum-post")
router.register("users", UserProfileViewSet, basename="user")
router.register("surveys", SurveyViewSet, basename="survey")
router.register("survey-responses", SurveyResponseViewSet, basename="survey-response")
router.register("notifications/subscriptions", PushSubscriptionViewSet, basename="push-subscription")
router.register("notifications/preferences", NotificationPreferenceViewSet, basename="notification-preference")
router.register("cohorts", CohortViewSet, basename="cohort")
router.register("enrollments", EnrollmentViewSet, basename="enrollment")
router.register("additional-resources", AdditionalResourceViewSet, basename="additional-resource")

urlpatterns = [
    path('admin/', admin.site.urls),
    path('app/', include('app.urls')),
    path('api/', include('app.api_urls')),
    path('api/', include(router.urls)),
    path('api/notifications/vapid-public-key/', vapid_public_key_view, name='vapid-public-key'),
]

if settings.DEBUG:
    # Dev-only: serves uploaded media (e.g. additional-resource cover images).
    # Production needs real media storage (S3/persistent volume) — not configured yet.
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
