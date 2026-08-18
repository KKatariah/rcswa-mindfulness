from rest_framework import serializers

from .models import ContentCompletion, ContentItem, Module, Resource, User


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