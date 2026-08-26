from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from .models import ContentCompletion, ContentItem, ForumPost, ForumThread, Module, Resource, User


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["email", "full_name", "password"]

    def create(self, validated_data):
        return User.objects.create_user(
            email=validated_data["email"],
            full_name=validated_data["full_name"],
            password=validated_data["password"],
        )


class ResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = ["id", "title", "url", "resource_type", "display_order"]


class ContentItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentItem
        fields = ["id", "title", "type", "provider", "embed_url", "display_order"]


class ModuleSerializer(serializers.ModelSerializer):
    # related_name="content_items" and related_name="resources" on the FK definitions
    content_items = ContentItemSerializer(many=True, read_only=True)
    resources = ResourceSerializer(many=True, read_only=True)

    class Meta:
        model = Module
        fields = [
            "id",
            "week_number",
            "title",
            "description",
            "content_items",
            "resources",
        ]


class ContentCompletionSerializer(serializers.ModelSerializer):
    # read_only=True: user is injected by the viewset, never accepted from the payload.
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = ContentCompletion
        fields = ["id", "user", "content_item", "completed_at"]
        read_only_fields = ["completed_at"]


# ── Forum ──────────────────────────────────────────────────────────────────────

def _can_edit(obj, request):
    """True if the requesting user authored obj or has admin/staff rights."""
    if not request or not request.user.is_authenticated:
        return False
    u = request.user
    if getattr(u, "role", None) == "admin" or u.is_staff:
        return True
    if isinstance(obj, ForumThread):
        return obj.created_by_id == u.pk
    return obj.author_id == u.pk


class ForumPostCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ForumPost
        fields = ["id", "thread", "parent_post", "body"]


class ForumPostSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = ForumPost
        fields = ["id", "thread", "parent_post", "author_name", "body", "created_at", "updated_at", "can_edit"]
        read_only_fields = ["thread", "parent_post", "created_at", "updated_at"]

    def get_author_name(self, obj):
        return obj.author.full_name if obj.author else "Deleted user"

    def get_can_edit(self, obj):
        return _can_edit(obj, self.context.get("request"))

    def update(self, instance, validated_data):
        instance.body = validated_data.get("body", instance.body)
        instance.save()
        return instance


def _is_admin(request):
    if not request or not request.user.is_authenticated:
        return False
    u = request.user
    return getattr(u, "role", None) == "admin" or u.is_staff


class ForumThreadSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    reply_count = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_pin = serializers.SerializerMethodField()

    class Meta:
        model = ForumThread
        fields = [
            "id", "title", "module", "content_item",
            "author_name", "created_at", "updated_at",
            "body", "reply_count", "can_edit", "is_pinned", "can_pin",
        ]
        read_only_fields = ["module", "content_item", "created_at", "updated_at"]

    def get_author_name(self, obj):
        return obj.created_by.full_name if obj.created_by else "Deleted user"

    def get_body(self, obj):
        posts = sorted(obj.posts.all(), key=lambda p: (p.created_at, p.pk))
        return posts[0].body if posts else ""

    def get_reply_count(self, obj):
        active = [p for p in obj.posts.all() if not p.is_deleted]
        return max(0, len(active) - 1)

    def get_can_edit(self, obj):
        return _can_edit(obj, self.context.get("request"))

    def get_can_pin(self, obj):
        return _is_admin(self.context.get("request"))

    def validate(self, attrs):
        if "is_pinned" in attrs and not _is_admin(self.context.get("request")):
            raise PermissionDenied("Only admins can pin or unpin threads.")
        return attrs


class ForumThreadDetailSerializer(ForumThreadSerializer):
    replies = serializers.SerializerMethodField()
    opening_post = serializers.SerializerMethodField()

    class Meta(ForumThreadSerializer.Meta):
        fields = ForumThreadSerializer.Meta.fields + ["opening_post", "replies"]

    def get_opening_post(self, obj):
        posts = sorted(obj.posts.all(), key=lambda p: (p.created_at, p.pk))
        if not posts:
            return None
        return ForumPostSerializer(posts[0], context=self.context).data

    def get_replies(self, obj):
        posts = sorted(obj.posts.all(), key=lambda p: (p.created_at, p.pk))
        first_id = posts[0].pk if posts else None
        replies = [p for p in posts if p.pk != first_id and not p.is_deleted]
        return ForumPostSerializer(replies, many=True, context=self.context).data


class ForumThreadCreateSerializer(serializers.ModelSerializer):
    # title is derived from the body on the server; not accepted from the client.
    body = serializers.CharField()

    class Meta:
        model = ForumThread
        fields = ["body", "module", "content_item"]

    def validate(self, data):
        if data.get("module") and data.get("content_item"):
            raise serializers.ValidationError(
                "Provide either 'module' or 'content_item', not both."
            )
        return data
