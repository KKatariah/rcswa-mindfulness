import re
import secrets
import unicodedata

from django.conf import settings as django_settings
from django.http import HttpResponse
from django.shortcuts import render
from django.utils import timezone
from django.db import transaction
from django.db.models import Count, Prefetch, ProtectedError
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from django.contrib.auth import authenticate
from rest_framework.authtoken.models import Token
from .serializers import ProfileUpdateSerializer, ChangePasswordSerializer
from .utils import gravatar_url

from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated

from .models import (
    AdditionalResource,
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

from .notifications import notify_survey_unlocked
from .permissions import IsAdminOrStaff, IsAdminOrSelf, IsApproved, user_is_approved
from .throttles import AuthRateThrottle
from .exports import cohort_names, survey_responses_csv


from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from django.conf import settings

from .serializers import (
    AdditionalResourceSerializer,
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
    SurveyAdminSerializer,
    SurveyDetailSerializer,
    SurveyResponseAdminSerializer,
    SurveyResponseSerializer,
    SurveyResponseUpdateSerializer,
    SurveySerializer,
    AdminUserSerializer,
    AdminUserUpdateSerializer,
    UserDisplayNameSerializer,
    _is_program_active,
    _pick_signup_cohort,
    module_is_unlocked,
    _survey_is_unlocked,
    _cohort_breakdown,
    _module_completion_stats,
    _module_student_progress,
    _user_overview,
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


def _enrollment_status(user):
    """Status of the user's most recent enrollment, or None if they have none."""
    e = Enrollment.objects.filter(user=user).order_by("-enrolled_at").first()
    return e.status if e else None


def _user_payload(user):
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "display_name": user.display_name,
        "avatar_url": gravatar_url(user.email),
        "auth_provider": user.auth_provider,
        "cohort_start_date": _active_cohort_start_date(user),
        "forum_rules_accepted": user.forum_rules_accepted_at is not None,
        "is_approved": user_is_approved(user),
        "enrollment_status": _enrollment_status(user),
    }


def _auto_enroll_new_user(user):
    """New signups are enrolled pending approval into the currently active
    cohort, or the soonest upcoming one if none is active yet."""
    cohort = _pick_signup_cohort()
    if cohort:
        Enrollment.objects.create(user=user, cohort=cohort, status=Enrollment.Status.PENDING)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthRateThrottle])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)

    if serializer.is_valid():
        user = serializer.save()
        _auto_enroll_new_user(user)

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
@throttle_classes([AuthRateThrottle])
def login_view(request):
    email = request.data.get("email")
    password = request.data.get("password")

    if not isinstance(email, str) or not isinstance(password, str) or not email or not password:
        return Response(
            {"error": "Email and password are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Emails are matched case-insensitively; authenticate() needs the stored spelling.
    match = User.objects.filter(email__iexact=email.strip()).first()
    user = authenticate(request, email=match.email, password=password) if match else None

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
@permission_classes([IsAuthenticated])  # plain IsAuthenticated: pending users must be able to log out
def logout_view(request):
    request.user.auth_token.delete()
    return Response(
        {"message": "Logout successful"},
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthRateThrottle])
def google_login_view(request):
    token = request.data.get("credential")

    if not isinstance(token, str) or not token:
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

    email = (idinfo.get("email") or "").strip().lower()
    full_name = idinfo.get("name", "")

    if not email:
        return Response(
            {"error": "Google account did not provide an email."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # An unverified address could belong to someone else, and we match accounts by email.
    if not idinfo.get("email_verified"):
        return Response(
            {"error": "Your Google email address isn't verified."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        user = User.objects.create_user(email=email, full_name=full_name, auth_provider="google")
        _auto_enroll_new_user(user)

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
        if not Enrollment.objects.filter(user=u, status=Enrollment.Status.ACTIVE).exists():
            return qs.none()  # not yet approved into an active cohort
        return qs.filter(is_published=True)

    def retrieve(self, request, *args, **kwargs):
        module = self.get_object()
        if not module_is_unlocked(module, request.user):
            raise PermissionDenied("This module is not available yet.")
        return Response(self.get_serializer(module).data)

    @action(detail=False, methods=["get"], permission_classes=[AllowAny])
    def summary(self, request):
        modules = Module.objects.filter(is_published=True).order_by("week_number")
        return Response(ModuleSummarySerializer(modules, many=True).data)

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Renumber weeks to match a new order: {"ids": [every module id, first week first]}.

        The modules keep the same set of week numbers, just reassigned, so gaps survive.
        """
        ids = request.data.get("ids")
        if not isinstance(ids, list) or not all(type(i) is int for i in ids):
            raise ValidationError({"ids": "Expected a list of module ids."})
        modules = {m.id: m for m in Module.objects.all()}
        if len(ids) != len(modules) or set(ids) != set(modules):
            raise ValidationError({"ids": "Must list every module exactly once."})
        weeks = sorted(m.week_number for m in modules.values())
        with transaction.atomic():
            # week_number is unique, so park everything on unused numbers before the real swap.
            for offset, module_id in enumerate(ids):
                Module.objects.filter(pk=module_id).update(week_number=30000 + offset)
            for week, module_id in zip(weeks, ids):
                Module.objects.filter(pk=module_id).update(week_number=week)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def progress(self, request, pk=None):
        """Which active students have (and haven't) worked through this module. ?cohort=<id> narrows it."""
        module = self.get_object()
        return Response(_module_student_progress(module, cohort_id=_id_param(request, "cohort")))

    def get_permissions(self):
        if self.action == "summary":
            return [AllowAny()]
        if self.action in ("create", "update", "partial_update", "destroy", "reorder", "progress"):
            return [IsApproved(), IsAdminOrStaff()]
        # The home page lists the programme for logged-out visitors. This override replaces
        # the action's own permission_classes, so it has to allow it here.
        if self.action == "summary":
            return [AllowAny()]
        return [IsApproved()]


class ContentItemViewSet(viewsets.ModelViewSet):
    serializer_class = ContentItemSerializer
    permission_classes = [IsApproved, IsAdminOrStaff]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = ContentItem.objects.select_related("module").order_by("module", "display_order")
        module_id = _id_param(self.request, "module")
        if module_id:
            qs = qs.filter(module_id=module_id)
        return qs

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Set a module's item order in one go: {"module": id, "ids": [item ids in display order]}."""
        module_id = request.data.get("module")
        ids = request.data.get("ids")
        if not isinstance(ids, list):
            raise ValidationError({"ids": "Expected a list of content item ids."})
        items = {item.id: item for item in ContentItem.objects.filter(module_id=module_id)}
        if sorted(ids) != sorted(items):
            raise ValidationError({"ids": "Must list every content item in the module exactly once."})
        with transaction.atomic():
            for position, item_id in enumerate(ids, start=1):
                items[item_id].display_order = position
            ContentItem.objects.bulk_update(items.values(), ["display_order"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class CohortViewSet(viewsets.ModelViewSet):
    queryset = Cohort.objects.all().order_by("-start_date")
    serializer_class = CohortSerializer
    permission_classes = [IsApproved, IsAdminOrStaff]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]


class AdditionalResourceViewSet(viewsets.ModelViewSet):
    queryset = AdditionalResource.objects.all()
    serializer_class = AdditionalResourceSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        # Any approved user can read; only admins/staff can write.
        if self.action in ("list", "retrieve"):
            return [IsApproved()]
        return [IsApproved(), IsAdminOrStaff()]

    def get_queryset(self):
        qs = super().get_queryset()
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        return qs

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Set a category's order in one go: {"category": c, "ids": [resource ids in display order]}."""
        category = request.data.get("category")
        ids = request.data.get("ids")
        if category not in AdditionalResource.Category.values:
            raise ValidationError({"category": "Unknown category."})
        if not isinstance(ids, list) or not all(type(i) is int for i in ids):
            raise ValidationError({"ids": "Expected a list of resource ids."})
        resources = {r.id: r for r in AdditionalResource.objects.filter(category=category)}
        if len(ids) != len(resources) or set(ids) != set(resources):
            raise ValidationError({"ids": "Must list every resource in the category exactly once."})
        with transaction.atomic():
            for position, resource_id in enumerate(ids, start=1):
                resources[resource_id].display_order = position
            AdditionalResource.objects.bulk_update(resources.values(), ["display_order"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class EnrollmentViewSet(viewsets.ModelViewSet):
    serializer_class = EnrollmentSerializer
    permission_classes = [IsApproved, IsAdminOrStaff]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = Enrollment.objects.select_related("user", "cohort").order_by("-enrolled_at")
        cohort_id = _id_param(self.request, "cohort")
        if cohort_id:
            qs = qs.filter(cohort_id=cohort_id)
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs


class ContentCompletionViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsApproved]
    serializer_class = ContentCompletionSerializer

    def get_queryset(self):
        return ContentCompletion.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        content_item = serializer.validated_data["content_item"]

        obj, created = ContentCompletion.objects.get_or_create(
            user=request.user,
            content_item=content_item,
        )

        # Check whether this new completion unlocks the module survey.
        if created:
            notify_survey_unlocked(
                user=request.user,
                module=content_item.module,
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

    permission_classes = [IsApproved]
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

def _id_param(request, name):
    """An optional numeric id from the query string; a 400, not a 500, if it isn't one."""
    raw = request.query_params.get(name)
    if raw in (None, ""):
        return None
    try:
        value = int(raw)
    except ValueError:
        raise ValidationError({name: "Must be a whole number."})
    if value < 1:
        raise ValidationError({name: "Must be a positive id."})
    return value


def _derive_title(body: str) -> str:
    """First ≤60 chars of body, trimmed at the nearest word boundary."""
    text = body.strip()
    if not text:
        return "Untitled"
    if len(text) <= 60:
        return text
    truncated = text[:60]
    boundary = truncated.rfind(" ")
    if boundary > 0:
        return truncated[:boundary]
    # No space to cut at: back off so we don't split an emoji or accented letter.
    cut = 60
    while cut > 1 and (_attaches_to_previous(text[cut]) or text[cut - 1] == "\u200d"):
        cut -= 1
    return text[:cut]


def _attaches_to_previous(ch: str) -> bool:
    """True for characters that belong to the one before them: zero-width joiner,
    variation selectors, skin-tone modifiers, tag characters and combining marks."""
    code = ord(ch)
    return (
        code == 0x200D
        or 0xFE00 <= code <= 0xFE0F
        or 0x1F3FB <= code <= 0x1F3FF
        or 0xE0020 <= code <= 0xE007F
        or unicodedata.combining(ch) != 0
    )


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


class HasAcceptedForumRules(BasePermission):
    message = "You must agree to the forum rules before using the forum."

    def has_permission(self, request, view):
        u = request.user
        # Admins moderate the forum and aren't asked to accept the rules.
        if getattr(u, "role", None) == "admin" or u.is_staff:
            return True
        return u.forum_rules_accepted_at is not None


class ForumThreadViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    throttle_scope = "forum_post"

    def get_throttles(self):
        # Only creating threads/posts is rate limited; reads and edits are not.
        return [ScopedRateThrottle()] if self.action == "create" else []

    def get_queryset(self):
        return (
            ForumThread.objects
            .prefetch_related(
                Prefetch("posts", queryset=ForumPost.objects.select_related("author"))
            )
            .select_related("created_by")
            .order_by("-is_pinned", "pin_order", "-updated_at")
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ForumThreadDetailSerializer
        return ForumThreadSerializer

    def partial_update(self, request, *args, **kwargs):
        with transaction.atomic():
            thread_before = self.get_object()
            was_pinned = thread_before.is_pinned
            response = super().partial_update(request, *args, **kwargs)
            thread = ForumThread.objects.get(pk=thread_before.pk)

            if "is_pinned" in request.data and thread.is_pinned != was_pinned:
                thread.reorder_pinned_threads(1 if thread.is_pinned else None)
                thread.refresh_from_db()
                response.data = self.get_serializer(thread).data

            return response

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
        with transaction.atomic():
            thread = serializer.save(created_by=self.request.user, title=title)
            head_post = ForumPost.objects.create(
                thread=thread,
                author=self.request.user,
                body=body,
                is_head_post=True,
            )
            thread.opened_by = head_post
            thread.save(update_fields=["opened_by"])

    def get_permissions(self):
        if self.action in ["partial_update", "destroy"]:
            return [IsApproved(), HasAcceptedForumRules(), IsAuthorOrAdmin()]
        return [IsApproved(), HasAcceptedForumRules()]


class ForumPostViewSet(
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    http_method_names = ["post", "patch", "delete", "head", "options"]
    serializer_class = ForumPostSerializer
    throttle_scope = "forum_post"

    def get_throttles(self):
        # Only creating threads/posts is rate limited; reads and edits are not.
        return [ScopedRateThrottle()] if self.action == "create" else []

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
        ForumThread.objects.filter(opened_by_id=post.pk).update(
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
            return [IsApproved(), HasAcceptedForumRules(), IsAuthorOrAdmin()]
        return [IsApproved(), HasAcceptedForumRules()]


# ── User profile ───────────────────────────────────────────────────────────────

# No look-alike characters (0/O, 1/l/I), since the admin will be copying or reading this out.
_TEMP_PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"


def _generate_temp_password(length=12):
    return "".join(secrets.choice(_TEMP_PASSWORD_CHARS) for _ in range(length))


class UserProfileViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsApproved]
    serializer_class = UserDisplayNameSerializer
    http_method_names = ["get", "patch", "delete", "head", "options", "post"]

    def get_queryset(self):
        u = self.request.user
        if getattr(u, "role", None) == "admin" or u.is_staff:
            return User.objects.all()
        return User.objects.filter(pk=u.pk)

    def get_serializer_class(self):
        u = self.request.user
        is_admin = getattr(u, "role", None) == "admin" or u.is_staff
        if self.action in ("partial_update", "update") and is_admin:
            return AdminUserUpdateSerializer
        if is_admin:
            return AdminUserSerializer
        return UserDisplayNameSerializer

    @action(detail=True, methods=["get"])
    def overview(self, request, pk=None):
        """An admin's view of one person: profile, enrollments, module progress, surveys, forum activity."""
        return Response(_user_overview(self.get_object()))

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        """Admin sets a random temporary password and returns it once so it can be sent to the student."""
        user = self.get_object()
        if user.pk == request.user.pk or user.role == User.Role.ADMIN:
            raise PermissionDenied("Admin passwords can't be reset here.")
        if user.auth_provider == "google" or not user.has_usable_password():
            raise ValidationError({"detail": "This account signs in with Google, so it has no password to reset."})
        temp_password = _generate_temp_password()
        user.set_password(temp_password)
        user.save(update_fields=["password"])
        # Sign them out everywhere; the old token is no longer valid.
        Token.objects.filter(user=user).delete()
        return Response({"temporary_password": temp_password})

    def get_permissions(self):
        if self.action in ("partial_update", "update"):
            return [IsApproved(), IsAdminOrSelf()]
        if self.action in ("destroy", "overview", "reset_password"):
            return [IsApproved(), IsAdminOrStaff()]
        return [IsApproved()]

    def perform_destroy(self, instance):
        if instance.pk == self.request.user.pk:
            raise PermissionDenied("You can't delete your own account.")
        if (
            instance.role == User.Role.ADMIN
            and not User.objects.filter(role=User.Role.ADMIN).exclude(pk=instance.pk).exists()
        ):
            raise PermissionDenied("There must always be at least one admin.")
        instance.delete()


# ── Surveys ────────────────────────────────────────────────────────────────────

class SurveyViewSet(viewsets.ModelViewSet):
    """Participants list and read surveys; admins also create, edit and delete them.

    GET /surveys/manage/            admin list with questions and response counts
    GET /surveys/{id}/responses/    admin view of one survey's responses
    """
    permission_classes = [IsApproved]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    _ADMIN_ACTIONS = ("create", "partial_update", "destroy", "manage", "responses")

    def get_permissions(self):
        if self.action in self._ADMIN_ACTIONS:
            return [IsApproved(), IsAdminOrStaff()]
        # Falls back to permission_classes, which @action(permission_classes=...) overrides (e.g. export).
        return super().get_permissions()

    def get_queryset(self):
        qs = (
            Survey.objects
            .select_related("module")
            .prefetch_related("module__content_items")
        )
        if self.action in self._ADMIN_ACTIONS:
            qs = qs.annotate(response_count=Count("responses")).order_by("module__week_number", "code")
        u = self.request.user
        if not (getattr(u, "role", None) == "admin" or u.is_staff):
            # Hide weekly surveys with a null module (orphaned) from students.
            qs = qs.exclude(type=Survey.SurveyType.WEEKLY, module__isnull=True)
        return qs

    def get_serializer_class(self):
        if self.action in self._ADMIN_ACTIONS:
            return SurveyAdminSerializer
        if self.action == "retrieve":
            return SurveyDetailSerializer
        return SurveySerializer

    def perform_destroy(self, instance):
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError({"detail": "This survey has responses, so it can't be deleted."})

    @action(detail=False, methods=["get"])
    def manage(self, request):
        return Response(self.get_serializer(self.get_queryset(), many=True).data)

    @action(detail=True, methods=["get"])
    def responses(self, request, pk=None):
        survey = self.get_object()
        responses = list(
            survey.responses.select_related("user").order_by("submitted_at")
        )
        cohorts = cohort_names({r.user_id for r in responses})
        return Response([
            {
                "id": r.pk,
                "participant_id": r.user_id,
                "full_name": r.user.full_name,
                "email": r.user.email,
                "cohort": cohorts.get(r.user_id, ""),
                "submitted_at": r.submitted_at,
                "answers": r.answers,
            }
            for r in responses
        ])

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # Batch-fetch completions once per request so get_is_unlocked is O(1) per survey.
        if self.request and self.request.user.is_authenticated:
            ctx["completed_ids"] = set(
                ContentCompletion.objects.filter(user=self.request.user)
                .values_list("content_item_id", flat=True)
            )
        return ctx

    @action(detail=False, methods=["get"], url_path="export", permission_classes=[IsApproved, IsAdminOrStaff])
    def export(self, request):
        """Admin-only CSV of survey responses.

        ?survey=<id>  limit to one survey (default: all surveys)
        ?identify=1   include participant names and emails (default: user id only)
        """
        surveys = Survey.objects.select_related("module").order_by("module__week_number", "code")
        survey_id = _id_param(request, "survey")
        if survey_id:
            surveys = surveys.filter(pk=survey_id)
            if not surveys.exists():
                return Response({"detail": "Survey not found."}, status=status.HTTP_404_NOT_FOUND)
        include_identity = request.query_params.get("identify") in ("1", "true")

        # Codes set before codes were validated may hold characters unsafe in a header.
        label = re.sub(r"[^A-Za-z0-9_-]", "_", surveys.first().code) if survey_id else "all"
        filename = f"survey-responses-{label}-{timezone.localdate().isoformat()}.csv"
        response = HttpResponse(
            survey_responses_csv(surveys, include_identity=include_identity),
            content_type="text/csv; charset=utf-8",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=False, methods=["get"], url_path="module-responses")
    def module_responses(self, request):
        u = request.user
        if not (getattr(u, "role", None) == "admin" or u.is_staff):
            raise PermissionDenied()
        module_id = _id_param(request, "module")
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
    permission_classes = [IsApproved]
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

    permission_classes = [IsApproved]
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

    permission_classes = [IsApproved]
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
@permission_classes([IsAuthenticated])  # plain IsAuthenticated: pending users read their status here
def current_user(request):
    return Response({"user": _user_payload(request.user)})


@api_view(["PATCH"])
@permission_classes([IsApproved])
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
@permission_classes([IsApproved])
def change_password_view(request):
    if not request.user.has_usable_password():
        return Response(
            {"error": "Password change is not available for accounts signed in with Google."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
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
@permission_classes([IsApproved, IsAdminOrStaff])
def dashboard_stats_view(request):
    return Response({
        "total_enrolled": Enrollment.objects.filter(status=Enrollment.Status.ACTIVE).count(),
        "by_cohort": _cohort_breakdown(),
        "modules": _module_completion_stats(),
        "survey_response_rates": _survey_response_rates(),
        "forum_activity": _forum_activity_stats(),
        "enrollment_status_breakdown": _enrollment_status_breakdown(),
    })


@api_view(["POST"])
@permission_classes([IsApproved])
def accept_forum_rules_view(request):
    user = request.user
    if user.forum_rules_accepted_at is None:
        user.forum_rules_accepted_at = timezone.now()
        user.save(update_fields=["forum_rules_accepted_at"])
    return Response({"user": _user_payload(user)})


@api_view(["GET"])
@permission_classes([IsApproved])
def program_status_view(request):
    return Response({"is_active": _is_program_active()})
