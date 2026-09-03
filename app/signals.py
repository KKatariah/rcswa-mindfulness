"""S21 signal handlers: fire content-update notifications when a Module or
ContentItem is published or materially updated.

Delivery is deferred out of the request/transaction via transaction.on_commit +
a daemon thread so admin saves are not blocked by up to 80 sequential push calls.
"""

import logging
import threading

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import ContentItem, Module

logger = logging.getLogger(__name__)

# Fields on ContentItem whose change warrants a student notification.
_MATERIAL_CONTENT_FIELDS = {"embed_url", "title", "type", "provider"}


def _fire_async(module_pk: int) -> None:
    """Called after transaction commit. Runs notify_content_update in a daemon thread
    so the admin HTTP response is not delayed by push/email delivery."""
    def _run():
        from .models import Module as M
        from .notifications import notify_content_update
        try:
            mod = M.objects.get(pk=module_pk)
        except M.DoesNotExist:
            return
        try:
            notify_content_update(module=mod)
        except Exception as exc:
            logger.error("S21 delivery error for module pk=%s: %s", module_pk, exc)

    threading.Thread(target=_run, daemon=True).start()


@receiver(post_save, sender=Module)
def module_post_save(sender, instance, created, **kwargs):
    """Notify enrolled students when a module is published or re-published."""
    if not instance.is_published:
        return
    update_fields = kwargs.get("update_fields")
    if update_fields is not None and "is_published" not in update_fields:
        return
    pk = instance.pk
    transaction.on_commit(lambda: _fire_async(pk))


@receiver(post_save, sender=ContentItem)
def content_item_post_save(sender, instance, created, **kwargs):
    """Notify enrolled students when a ContentItem is added or its media URL/title changes.

    day_offset edits (Sarah setting up the schedule) do NOT trigger this path:
    - If the module is not published yet, we return immediately.
    - If update_fields is provided and contains only non-material fields (e.g.
      day_offset, display_order), we return immediately.
    - If the admin saves a full form (update_fields=None), we fall through to the
      debounce inside notify_content_update which suppresses bursts within 60 min.
      The cohort start-date gate in notify_content_update additionally prevents any
      send to students whose cohort has not yet begun.
    """
    if not instance.module.is_published:
        return
    update_fields = kwargs.get("update_fields")
    if update_fields is not None and not _MATERIAL_CONTENT_FIELDS.intersection(update_fields):
        return
    pk = instance.module_id
    transaction.on_commit(lambda: _fire_async(pk))
