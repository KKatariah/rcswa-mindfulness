from django.conf import settings
from django.contrib import admin
from django.urls import path, include, re_path
from django.views.static import serve
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
    NotificationHistoryViewSet,
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
router.register("notifications/history", NotificationHistoryViewSet, basename="notification-history")
router.register("cohorts", CohortViewSet, basename="cohort")
router.register("enrollments", EnrollmentViewSet, basename="enrollment")
router.register("additional-resources", AdditionalResourceViewSet, basename="additional-resource")

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('app.api_urls')),
    path('api/', include(router.urls)),
    path('api/notifications/vapid-public-key/', vapid_public_key_view, name='vapid-public-key'),
]


def serve_media(request, path):
    """An uploaded file (resource cover images). Light enough for this app's traffic;
    with SERVE_MEDIA=False a reverse proxy serves MEDIA_ROOT at /media/ instead."""
    response = serve(request, path, document_root=settings.MEDIA_ROOT)
    # Uploads are only ever shown as images: never let one run as a page on this origin.
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["X-Content-Type-Options"] = "nosniff"
    # A new upload gets a new file name, so a day of caching is safe.
    response["Cache-Control"] = "public, max-age=86400"
    return response


if settings.SERVE_MEDIA:
    urlpatterns += [re_path(rf"^{settings.MEDIA_URL.lstrip('/')}(?P<path>.+)$", serve_media)]
