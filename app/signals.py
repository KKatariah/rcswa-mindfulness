"""S21 signal handlers: fire content-update notifications when a Module or
ContentItem is published or materially updated."""

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import ContentItem, Module


@receiver(post_save, sender=Module)
def module_post_save(sender, instance, created, **kwargs):
    """Notify enrolled students when a module is published or re-published."""
    if not instance.is_published:
        return
    # Only send when the module was just published (created+published, or
    # is_published flipped from False→True).  We detect the flip by comparing
    # to the DB value stored before this save; Django doesn't give us the old
    # value directly in post_save, so we check the update_fields hint when
    # available (management commands and the admin pass it).  When update_fields
    # is absent (full save), we always fire — the debounce in notify_content_update
    # prevents flooding on rapid sequential saves.
    update_fields = kwargs.get("update_fields")
    if update_fields is not None and "is_published" not in update_fields:
        return
    from .notifications import notify_content_update
    notify_content_update(module=instance)


@receiver(post_save, sender=ContentItem)
def content_item_post_save(sender, instance, created, **kwargs):
    """Notify enrolled students when a ContentItem is added or its URL/title changes."""
    module = instance.module
    if not module.is_published:
        return
    update_fields = kwargs.get("update_fields")
    # Only fire on material changes: creation or explicit URL/title/type edits.
    material_fields = {"embed_url", "title", "type", "provider"}
    if update_fields is not None and not material_fields.intersection(update_fields):
        return
    from .notifications import notify_content_update
    notify_content_update(module=module)
