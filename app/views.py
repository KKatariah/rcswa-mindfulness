from django.shortcuts import render
from django.db.models import Prefetch
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from django.contrib.auth import authenticate
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated

from .models import (
    ContentCompletion,
    ContentItem,
    ForumPost,
    ForumThread,
    Module,
    Survey,
    SurveyResponse,
    User,
)
from .serializers import (
    ContentCompletionSerializer,
    ForumPostCreateSerializer,
    ForumPostSerializer,
    ForumThreadCreateSerializer,
    ForumThreadDetailSerializer,
    ForumThreadSerializer,
    ModuleSerializer,
    RegisterSerializer,
    SurveyDetailSerializer,
    SurveyResponseAdminSerializer,
    SurveyResponseSerializer,
    SurveyResponseUpdateSerializer,
    SurveySerializer,
    UserDisplayNameSerializer,
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
