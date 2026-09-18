from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from app.views import (
    ContentCompletionViewSet,
    ModuleViewSet,
    NotificationPreferenceViewSet,
    PushSubscriptionViewSet,
    SurveyResponseViewSet,
    SurveyViewSet,
    vapid_public_key_view,
    ContentViewViewSet,
    ForumPostViewSet,
    ForumThreadViewSet,
    UserProfileViewSet,
)

router = DefaultRouter()
router.register("modules", ModuleViewSet, basename="module")
router.register("progress", ContentCompletionViewSet, basename="progress")
router.register("content-views", ContentViewViewSet, basename="content-view")
router.register("forum/threads", ForumThreadViewSet, basename="forum-thread")
router.register("forum/posts", ForumPostViewSet, basename="forum-post")
router.register("users", UserProfileViewSet, basename="user")
router.register("surveys", SurveyViewSet, basename="survey")
router.register("survey-responses", SurveyResponseViewSet, basename="survey-response")
router.register("notifications/subscriptions", PushSubscriptionViewSet, basename="push-subscription")
router.register("notifications/preferences", NotificationPreferenceViewSet, basename="notification-preference")

urlpatterns = [
    path('admin/', admin.site.urls),
    path('__reload__/', include('django_browser_reload.urls')),
    path('app/', include('app.urls')),
    path('api/', include('app.api_urls')),
    path('api/', include(router.urls)),
    path('api/notifications/vapid-public-key/', vapid_public_key_view, name='vapid-public-key'),
]
