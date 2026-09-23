from django.conf import settings as django_settings
from django.shortcuts import render
from django.utils import timezone
from django.db.models import Prefetch
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from django.contrib.auth import authenticate
from rest_framework.authtoken.models import Token
from .serializers import ProfileUpdateSerializer, ChangePasswordSerializer

from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated

from .models import (
    Cohort,
    ContentCompletion,
    ContentItem,
    ContentView,
    Enrollment,
    ForumPost,
    ForumThread,
    Module,
    NotificationPreference,
    PushSubscription,
    Survey,
    SurveyResponse,
    User,
)

from .permissions import IsAdminOrStaff


from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from django.conf import settings

from .serializers import (
    CohortSerializer,
    ContentCompletionSerializer,
    ContentItemSerializer,
    ContentViewSerializer,
    EnrollmentSerializer,
    ForumPostCreateSerializer,
    ForumPostSerializer,
    ForumThreadCreateSerializer,
    ForumThreadDetailSerializer,
    ForumThreadSerializer,
    ModuleSerializer,
    ModuleSummarySerializer,
    NotificationPreferenceSerializer,
    PushSubscriptionSerializer,
    RegisterSerializer,
    SurveyDetailSerializer,
    SurveyResponseAdminSerializer,
    SurveyResponseSerializer,
    SurveyResponseUpdateSerializer,
    SurveySerializer,
    UserDisplayNameSerializer,
    _is_program_active,
    _survey_is_unlocked,
    _cohort_breakdown,
    _module_completion_stats,
    _survey_response_rates,
    _forum_activity_stats,
    _enrollment_status_breakdown,
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


def _active_cohort_start_date(user):
    enrollment = (
        Enrollment.objects
        .filter(user=user, status=Enrollment.Status.ACTIVE)
        .select_related("cohort")
        .order_by("-enrolled_at")
        .first()
    )
    return enrollment.cohort.start_date.isoformat() if enrollment else None


def _user_payload(user):
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "display_name": user.display_name,
        "auth_provider": user.auth_provider,
        "cohort_start_date": _active_cohort_start_date(user),
    }


@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)

    if serializer.is_valid():
        user = serializer.save()

        return Response(
            {
                "message": "Registration successful",
                "user": _user_payload(user),
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
            "user": _user_payload(user),
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


@api_view(["POST"])
@permission_classes([AllowAny])
def google_login_view(request):
    token = request.data.get("credential")

    if not token:
        return Response(
            {"error": "Google credential token is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        idinfo = id_token.verify_oauth2_token(
            token, google_requests.Request(), settings.GOOGLE_CLIENT_ID
        )
    except ValueError:
        return Response(
            {"error": "Invalid Google token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    email = idinfo.get("email")
    full_name = idinfo.get("name", "")

    if not email:
        return Response(
            {"error": "Google account did not provide an email."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user, created = User.objects.get_or_create(
        email=email,
        defaults={"full_name": full_name, "auth_provider": "google"},
    )

    if created:
        user.set_unusable_password()
        user.save()

    token_obj, _ = Token.objects.get_or_create(user=user)

    return Response(
        {
            "message": "Google login successful",
            "token": token_obj.key,
            "user": _user_payload(user),
        },
        status=status.HTTP_200_OK,
    )


class ModuleViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = (
            Module.objects
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
        u = self.request.user
        if getattr(u, "role", None) == "admin" or u.is_staff:
            return qs  # admins see unpublished modules too
        return qs.filter(is_published=True)

    def retrieve(self, request, *args, **kwargs):
        module = self.get_object()
        if module.unlock_at and module.unlock_at > timezone.now():
            raise PermissionDenied("This module is not available yet.")
        return Response(self.get_serializer(module).data)

    @action(detail=False, methods=["get"], permission_classes=[AllowAny])
    def summary(self, request):
        modules = Module.objects.filter(is_published=True).order_by("week_number")
        return Response(ModuleSummarySerializer(modules, many=True).data)

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

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAuthenticated(), IsAdminOrStaff()]
        return [IsAuthenticated()]


class ContentItemViewSet(viewsets.ModelViewSet):
    serializer_class = ContentItemSerializer
    permission_classes = [IsAuthenticated, IsAdminOrStaff]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = ContentItem.objects.select_related("module").order_by("module", "display_order")
        module_id = self.request.query_params.get("module")
        if module_id:
            qs = qs.filter(module_id=module_id)
        return qs


class CohortViewSet(viewsets.ModelViewSet):
    queryset = Cohort.objects.all().order_by("-start_date")
    serializer_class = CohortSerializer
    permission_classes = [IsAuthenticated, IsAdminOrStaff]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]


class EnrollmentViewSet(viewsets.ModelViewSet):
    serializer_class = EnrollmentSerializer
    permission_classes = [IsAuthenticated, IsAdminOrStaff]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = Enrollment.objects.select_related("user", "cohort").order_by("-enrolled_at")
        cohort_id = self.request.query_params.get("cohort")
        if cohort_id:
            qs = qs.filter(cohort_id=cohort_id)
        return qs


class ContentCompletionViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
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


class ContentViewViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """Auto-recorded when a student opens a content item; separate from manual completion."""

    serializer_class = ContentViewSerializer

    def get_queryset(self):
        return ContentView.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj, created = ContentView.objects.get_or_create(
            user=request.user,
            module=serializer.validated_data["module"],
        )
        out = self.get_serializer(obj)
        return Response(
            out.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


# ── Forum ──────────────────────────────────────────────────────────────────────

def _derive_title(body: str) -> str:
    """First ≤60 chars of body, trimmed at the nearest word boundary."""
    text = body.strip()
    if not text:
        return "Untitled"
    if len(text) <= 60:
        return text
    truncated = text[:60]
    boundary = truncated.rfind(" ")
    return truncated[:boundary] if boundary > 0 else truncated


class IsAuthorOrAdmin(BasePermission):
    def has_object_permission(self, request, view, obj):
        u = request.user
        if getattr(u, "role", None) == "admin" or u.is_staff:
            return True
        if isinstance(obj, ForumThread):
            return obj.created_by_id == u.pk
        if isinstance(obj, ForumPost):
            return obj.author_id == u.pk
        return False


class IsSelf(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.pk == request.user.pk


class ForumThreadViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return (
            ForumThread.objects
            .prefetch_related(
                Prefetch("posts", queryset=ForumPost.objects.select_related("author"))
            )
            .select_related("created_by")
            .order_by("-is_pinned", "-updated_at")
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ForumThreadDetailSerializer
        return ForumThreadSerializer

    def create(self, request, *args, **kwargs):
        serializer = ForumThreadCreateSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        out = ForumThreadSerializer(serializer.instance, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED, headers=self.get_success_headers(out.data))

    def perform_create(self, serializer):
        if not _is_program_active():
            raise PermissionDenied("The program has ended; the forum is read-only.")
        body = serializer.validated_data.pop("body")
        title = _derive_title(body)
        thread = serializer.save(created_by=self.request.user, title=title)
        ForumPost.objects.create(thread=thread, author=self.request.user, body=body)

    def get_permissions(self):
        if self.action in ["partial_update", "destroy"]:
            return [IsAuthenticated(), IsAuthorOrAdmin()]
        return [IsAuthenticated()]


class ForumPostViewSet(
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    http_method_names = ["post", "patch", "delete", "head", "options"]
    serializer_class = ForumPostSerializer

    def get_queryset(self):
        return ForumPost.objects.filter(is_deleted=False).select_related("author")

    def get_serializer_class(self):
        if self.action == "create":
            return ForumPostCreateSerializer
        return ForumPostSerializer

    def create(self, request, *args, **kwargs):
        create_ser = ForumPostCreateSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        create_ser.is_valid(raise_exception=True)
        self.perform_create(create_ser)
        out = ForumPostSerializer(create_ser.instance, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED, headers=self.get_success_headers(out.data))

    def perform_create(self, serializer):
        if not _is_program_active():
            raise PermissionDenied("The program has ended; the forum is read-only.")
        serializer.save(author=self.request.user)

    def perform_update(self, serializer):
        serializer.save()
        post = serializer.instance
        first_id = (
            ForumPost.objects
            .filter(thread_id=post.thread_id)
            .order_by("created_at", "pk")
            .values_list("pk", flat=True)
            .first()
        )
        if first_id == post.pk:
            ForumThread.objects.filter(pk=post.thread_id).update(
                title=_derive_title(post.body)
            )

    def perform_destroy(self, instance):
        first_id = (
            ForumPost.objects
            .filter(thread_id=instance.thread_id)
            .order_by("created_at", "pk")
            .values_list("pk", flat=True)
            .first()
        )
        if first_id == instance.pk:
            raise ValidationError(
                "Cannot delete the opening post. Delete the thread instead."
            )
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])

    def get_permissions(self):
        if self.action in ["partial_update", "destroy"]:
            return [IsAuthenticated(), IsAuthorOrAdmin()]
        return [IsAuthenticated()]


# ── User profile ───────────────────────────────────────────────────────────────

class UserProfileViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated]
    serializer_class = UserDisplayNameSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        u = self.request.user
        if getattr(u, "role", None) == "admin" or u.is_staff:
            return User.objects.all()
        return User.objects.filter(pk=u.pk)

    def get_permissions(self):
        if self.action in ("partial_update", "update"):
            return [IsAuthenticated(), IsSelf()]
        return [IsAuthenticated()]


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


@api_view(["GET"])
@permission_classes([AllowAny])
def vapid_public_key_view(request):
    """
    Return the VAPID public key so the frontend can call
    pushManager.subscribe({ applicationServerKey: key }).
    This endpoint is intentionally unauthenticated — the public key is public.
    """
    return Response({"vapid_public_key": django_settings.VAPID_PUBLIC_KEY})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def current_user(request):
    return Response({"user": _user_payload(request.user)})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_profile_view(request):
    serializer = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
    if serializer.is_valid():
        serializer.save()
        return Response(
            {"message": "Profile updated", "user": _user_payload(request.user)},
            status=status.HTTP_200_OK,
        )
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    if not request.user.has_usable_password():
        return Response(
            {"error": "Password change is not available for accounts signed in with Google."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = ChangePasswordSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    current_password = serializer.validated_data["current_password"]
    new_password = serializer.validated_data["new_password"]

    if not request.user.check_password(current_password):
        return Response(
            {"error": "Current password is incorrect."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    request.user.set_password(new_password)
    request.user.save()

    # Password change invalidates old sessions/tokens for security — issue a fresh token
    request.user.auth_token.delete()
    new_token = Token.objects.create(user=request.user)

    return Response(
        {"message": "Password changed successfully", "token": new_token.key},
        status=status.HTTP_200_OK,
    )


# ── Admin dashboard & program status ─────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminOrStaff])
def dashboard_stats_view(request):
    return Response({
        "total_enrolled": Enrollment.objects.filter(status=Enrollment.Status.ACTIVE).count(),
        "by_cohort": _cohort_breakdown(),
        "modules": _module_completion_stats(),
        "survey_response_rates": _survey_response_rates(),
        "forum_activity": _forum_activity_stats(),
        "enrollment_status_breakdown": _enrollment_status_breakdown(),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def program_status_view(request):
    return Response({"is_active": _is_program_active()})
