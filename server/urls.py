from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from app.views import (
    ContentCompletionViewSet,
    ContentViewViewSet,
    ForumPostViewSet,
    ForumThreadViewSet,
    ModuleViewSet,
    SurveyResponseViewSet,
    SurveyViewSet,
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

urlpatterns = [
    path('admin/', admin.site.urls),
    path('app/', include('app.urls')),
    path('api/', include('app.api_urls')),
    path('api/', include(router.urls)),
]
