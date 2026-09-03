from django.shortcuts import render
from django.db.models import Prefetch
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from django.contrib.auth import authenticate
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from .models import ContentCompletion, ContentItem, Module, NotificationPreference, PushSubscription, Survey, SurveyResponse
from .serializers import (
    ContentCompletionSerializer,
    ModuleSerializer,
    NotificationPreferenceSerializer,
    PushSubscriptionSerializer,
    RegisterSerializer,
    SurveyDetailSerializer,
    SurveyResponseAdminSerializer,
    SurveyResponseSerializer,
    SurveyResponseUpdateSerializer,
    SurveySerializer,
    _survey_is_unlocked,
)

# Create your views here.


def index_view(request):
    return render(request, 'app/index.html')


def profile_view(request):
    context = {
        "name": "placeholder"
    }  # will need to start on class forms next in forms.py
    return render(request, 'app/profile.html', context)


# API views


@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)

    if serializer.is_valid():
        user = serializer.save()

        return Response(
            {
                "message": "Registration successful",
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "full_name": user.full_name,
                },
            },
            status=status.HTTP_201_CREATED,
        )

    return Response(
        serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    email = request.data.get("email")
    password = request.data.get("password")

    if not email or not password:
        return Response(
            {"error": "Email and password are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = authenticate(request, email=email, password=password)

    if user is None:
        return Response(
            {"error": "Invalid credentials."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    token, _ = Token.objects.get_or_create(user=user)

    return Response(
        {
            "message": "Login successful",
            "token": token.key,
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
            },
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    request.user.auth_token.delete()
    return Response(
        {"message": "Logout successful"},
        status=status.HTTP_200_OK,
    )


class ModuleViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ModuleSerializer
    queryset = (
        Module.objects
        .filter(is_published=True)
        .prefetch_related(
            # display_order already exists on ContentItem; secondary sort by id keeps
            # ordering stable when display_order values tie (e.g. all default to 0).
            Prefetch(
                "content_items",
                queryset=ContentItem.objects.order_by("display_order", "id"),
            ),
            "resources",
        )
    )


class ContentCompletionViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ContentCompletionSerializer

    def get_queryset(self):
        return ContentCompletion.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj, created = ContentCompletion.objects.get_or_create(
            user=request.user,
            content_item=serializer.validated_data["content_item"],
        )
        out = self.get_serializer(obj)
        return Response(
            out.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


# ── Surveys ────────────────────────────────────────────────────────────────────

class SurveyViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Survey.objects
            .select_related("module")
            .prefetch_related("module__content_items")
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return SurveyDetailSerializer
        return SurveySerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # Batch-fetch completions once per request so get_is_unlocked is O(1) per survey.
        if self.request and self.request.user.is_authenticated:
            ctx["completed_ids"] = set(
                ContentCompletion.objects.filter(user=self.request.user)
                .values_list("content_item_id", flat=True)
            )
        return ctx

    @action(detail=False, methods=["get"], url_path="module-responses")
    def module_responses(self, request):
        u = request.user
        if not (getattr(u, "role", None) == "admin" or u.is_staff):
            raise PermissionDenied()
        module_id = request.query_params.get("module")
        if not module_id:
            return Response(
                {"detail": "module query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        responses = (
            SurveyResponse.objects
            .filter(survey__module_id=module_id)
            .select_related("user", "survey")
            .order_by("submitted_at")
        )
        serializer = SurveyResponseAdminSerializer(
            responses, many=True, context=self.get_serializer_context()
        )
        return Response(serializer.data)


class SurveyResponseViewSet(
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated]
    http_method_names = ["post", "patch", "head", "options"]

    def get_queryset(self):
        return SurveyResponse.objects.filter(user=self.request.user).select_related("survey")

    def get_serializer_class(self):
        if self.action in ("partial_update", "update"):
            return SurveyResponseUpdateSerializer
        return SurveyResponseSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        survey = serializer.validated_data["survey"]

        if not _survey_is_unlocked(survey, request.user):
            return Response(
                {"detail": "This survey is locked. Complete all module content first."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if SurveyResponse.objects.filter(user=request.user, survey=survey).exists():
            return Response(
                {"detail": "You have already submitted this survey. Use PATCH to update your response."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


# ── Push notification subscriptions ───────────────────────────────────────────

class PushSubscriptionViewSet(
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    Register and manage browser Push API subscriptions.

    POST   /api/notifications/subscriptions/       register or refresh
    GET    /api/notifications/subscriptions/       list own subscriptions
    DELETE /api/notifications/subscriptions/{id}/  unregister

    Registration is an upsert keyed on `endpoint`.  If the endpoint already
    belongs to a different user (e.g. shared campus browser), the subscription
    is reassigned to the currently authenticated user.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = PushSubscriptionSerializer

    def get_queryset(self):
        return PushSubscription.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj, created = PushSubscription.objects.update_or_create(
            endpoint=serializer.validated_data["endpoint"],
            defaults={
                "user": request.user,
                "p256dh": serializer.validated_data["p256dh"],
                "auth": serializer.validated_data["auth"],
                "user_agent": request.META.get("HTTP_USER_AGENT", ""),
            },
        )
        out = self.get_serializer(obj)
        return Response(
            out.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


# ── Notification preferences ───────────────────────────────────────────────────

class NotificationPreferenceViewSet(
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """
    GET  /api/notifications/preferences/me/  — retrieve (auto-creates on first call)
    PATCH /api/notifications/preferences/me/ — update
    """

    permission_classes = [IsAuthenticated]
    serializer_class = NotificationPreferenceSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def _get_or_create_pref(self):
        pref, _ = NotificationPreference.objects.get_or_create(user=self.request.user)
        return pref

    @action(detail=False, methods=["get", "patch"], url_path="me")
    def me(self, request):
        pref = self._get_or_create_pref()
        if request.method == "GET":
            return Response(self.get_serializer(pref).data)
        serializer = self.get_serializer(pref, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def get_queryset(self):
        return NotificationPreference.objects.filter(user=self.request.user)


# ── VAPID public key (unauthenticated) ─────────────────────────────────────────

from django.conf import settings as django_settings


@api_view(["GET"])
@permission_classes([AllowAny])
def vapid_public_key_view(request):
    """
    Return the VAPID public key so the frontend can call
    pushManager.subscribe({ applicationServerKey: key }).
    This endpoint is intentionally unauthenticated — the public key is public.
    """
    return Response({"vapid_public_key": django_settings.VAPID_PUBLIC_KEY})
