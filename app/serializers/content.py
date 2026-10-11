"""Programme content: modules, content items, resources and student progress."""


from django.db.models import Max
from rest_framework import serializers

from ..access import (
    module_is_unlocked,
    module_unlock_date,
)
from ..models import (
    AdditionalResource,
    ContentCompletion,
    ContentItem,
    ContentView,
    Module,
)


# Largest cover image an admin can upload.
COVER_IMAGE_MAX_BYTES = 5 * 1024 * 1024


class AdditionalResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdditionalResource
        fields = [
            "id",
            "category",
            "title",
            "author",
            "url",
            "cover_image",
            "display_order",
            "created_at",
            "updated_at",
        ]
        # Order is set by appending to the category and changed only via the reorder action,
        # so two resources can't be given the same slot.
        read_only_fields = ["id", "display_order", "created_at", "updated_at"]

    def validate_cover_image(self, image):
        if image and image.size > COVER_IMAGE_MAX_BYTES:
            raise serializers.ValidationError("Cover images must be 5 MB or smaller.")
        return image

    @staticmethod
    def _end_of(category):
        last = AdditionalResource.objects.filter(category=category).aggregate(Max("display_order"))
        return (last["display_order__max"] or 0) + 1

    def create(self, validated_data):
        validated_data["display_order"] = self._end_of(validated_data["category"])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        category = validated_data.get("category", instance.category)
        if category != instance.category:
            validated_data["display_order"] = self._end_of(category)
        return super().update(instance, validated_data)


class ContentItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentItem
        fields = ["id", "module", "title", "type", "provider", "embed_url", "display_order", "day_offset"]

    def validate_day_offset(self, value):
        # 0 = first day of the module's week; send_due_reminders only ever looks for 0-6.
        if value is not None and value > 6:
            raise serializers.ValidationError("Reminder day must be between 0 and 6.")
        return value

    def validate(self, attrs):
        provider = attrs.get("provider", getattr(self.instance, "provider", ""))
        embed_url = attrs.get("embed_url", getattr(self.instance, "embed_url", ""))
        if not provider:
            raise serializers.ValidationError({"provider": "Content items require a provider."})
        if not embed_url:
            raise serializers.ValidationError({"embed_url": "Content items require an embed_url."})
        return attrs

    def create(self, validated_data):
        # New items go to the end of their module unless a position is given.
        if "display_order" not in validated_data:
            last = validated_data["module"].content_items.order_by("-display_order").first()
            validated_data["display_order"] = last.display_order + 1 if last else 1
        return super().create(validated_data)


class ModuleSerializer(serializers.ModelSerializer):
    unlock_at = serializers.SerializerMethodField()
    is_unlocked = serializers.SerializerMethodField()

    def _user(self):
        request = self.context.get("request")
        return request.user if request else None

    def get_unlock_at(self, obj):
        user = self._user()
        unlock_date = module_unlock_date(obj, user) if user else None
        return unlock_date.isoformat() if unlock_date else None

    def get_is_unlocked(self, obj):
        user = self._user()
        return bool(user) and module_is_unlocked(obj, user)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not data["is_unlocked"]:
            data["content_items"] = []
        return data

    content_items = ContentItemSerializer(many=True, read_only=True)

    class Meta:
        model = Module
        fields = [
            "id",
            "week_number",
            "unlock_at",
            "is_unlocked",
            "title",
            "description",
            "summary",
            "is_published",
            "content_items",
        ]


class ModuleSummarySerializer(serializers.ModelSerializer):
    """Public-safe module summary (short blurb only, no full content) for marketing pages."""

    class Meta:
        model = Module
        fields = ["id", "week_number", "title", "summary"]


class ContentCompletionSerializer(serializers.ModelSerializer):
    def validate_content_item(self, item):
        if not module_is_unlocked(item.module, self.context["request"].user):
            raise serializers.ValidationError("This module is not available yet.")
        return item

    # read_only=True: user is injected by the viewset, never accepted from the payload.
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = ContentCompletion
        fields = ["id", "user", "content_item", "completed_at"]
        read_only_fields = ["completed_at"]


class ContentViewSerializer(serializers.ModelSerializer):
    def validate_module(self, module):
        # Same rule as opening the module page: unpublished or locked modules can't be "viewed".
        if not module_is_unlocked(module, self.context["request"].user):
            raise serializers.ValidationError("This module is not available yet.")
        return module

    # read_only=True: user is injected by the viewset, never accepted from the payload.
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = ContentView
        fields = ["id", "user", "module", "viewed_at"]
        read_only_fields = ["viewed_at"]
