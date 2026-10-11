"""Signal handlers: content-update notifications, survey title sync and resource cover clean-up."""

import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from ..models import AdditionalResource, ContentItem, Module, Survey, SurveyType
from ..signals import _fire_async
from .base import TestCase


class _RunInline:
    """Stands in for threading.Thread so _fire_async's work runs before the test checks it."""

    def __init__(self, target, daemon):
        self.target = target
        self.daemon = daemon

    def start(self):
        self.target()


@patch("app.signals.threading.Thread", _RunInline)
class FireAsyncTests(TestCase):
    def test_notifies_for_the_module(self):
        module = Module.objects.create(week_number=1, title="Week 1")
        with patch("app.notifications.notify_content_update") as notify:
            _fire_async(module.pk)
        notify.assert_called_once_with(module=module)

    def test_does_nothing_if_the_module_was_deleted_first(self):
        with patch("app.notifications.notify_content_update") as notify:
            _fire_async(999999)
        notify.assert_not_called()

    def test_a_delivery_failure_is_logged_not_raised(self):
        module = Module.objects.create(week_number=1, title="Week 1")
        with patch("app.notifications.notify_content_update", side_effect=RuntimeError("boom")):
            with self.assertLogs("app.signals", "ERROR") as logs:
                _fire_async(module.pk)
        self.assertIn(f"delivery error for module pk={module.pk}", logs.output[0])

    def test_runs_in_a_daemon_thread(self):
        with patch("app.signals.threading.Thread") as thread:
            _fire_async(1)
        self.assertTrue(thread.call_args.kwargs["daemon"])
        thread.return_value.start.assert_called_once()


@patch("app.signals._fire_async")
class ContentUpdateSignalTests(TestCase):
    """Which saves notify students: publishing, and material changes to published content."""

    def _saves(self, fire, action):
        with self.captureOnCommitCallbacks(execute=True):
            action()
        return fire.call_count

    def test_publishing_a_module_notifies(self, fire):
        module = Module.objects.create(week_number=1, title="Week 1")
        module.is_published = True
        self.assertEqual(self._saves(fire, module.save), 1)
        fire.assert_called_with(module.pk)

    def test_saving_a_draft_module_does_not(self, fire):
        self.assertEqual(self._saves(fire, lambda: Module.objects.create(week_number=1, title="Draft")), 0)

    def test_saving_other_fields_of_a_published_module_does_not(self, fire):
        module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        fire.reset_mock()
        module.title = "Renamed"
        self.assertEqual(self._saves(fire, lambda: module.save(update_fields=["title"])), 0)

    def test_a_material_change_to_published_content_notifies(self, fire):
        module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        item = ContentItem.objects.create(module=module, title="Body scan", type="audio", provider="soundcloud")
        fire.reset_mock()
        item.title = "Body scan (new recording)"
        self.assertEqual(self._saves(fire, lambda: item.save(update_fields=["title"])), 1)
        fire.assert_called_with(module.pk)

    def test_reordering_or_scheduling_content_does_not(self, fire):
        module = Module.objects.create(week_number=1, title="Week 1", is_published=True)
        item = ContentItem.objects.create(module=module, title="Body scan", type="audio", provider="soundcloud")
        fire.reset_mock()
        item.display_order, item.day_offset = 3, 2
        self.assertEqual(self._saves(fire, lambda: item.save(update_fields=["display_order", "day_offset"])), 0)

    def test_content_in_a_draft_module_does_not(self, fire):
        module = Module.objects.create(week_number=1, title="Draft")
        self.assertEqual(
            self._saves(fire, lambda: ContentItem.objects.create(module=module, title="x", type="audio", provider="soundcloud")),
            0,
        )


@patch("app.signals._fire_async")
class SurveyTitleSyncEdgeCaseTests(TestCase):
    def setUp(self):
        self.module = Module.objects.create(week_number=3, title="Week 3")
        self.survey = Survey.objects.get(module=self.module, type=SurveyType.WEEKLY)

    def test_saving_other_fields_leaves_the_title(self, _fire):
        self.module.week_number = 5
        self.module.title = "Changed"
        self.module.save(update_fields=["title"])
        self.survey.refresh_from_db()
        self.assertEqual(self.survey.title, "Week 3")

    def test_a_module_without_a_weekly_survey_is_fine(self, _fire):
        self.survey.delete()
        self.module.week_number = 6
        self.module.save()  # no error
        self.assertFalse(Survey.objects.filter(module=self.module).exists())

    def test_a_row_deleted_before_saving_is_fine(self, _fire):
        stale = Module.objects.get(pk=self.module.pk)
        Module.objects.filter(pk=self.module.pk).delete()
        stale.week_number = 7
        stale.save()  # recreated with the same pk; nothing to sync
        self.assertTrue(Module.objects.filter(pk=stale.pk, week_number=7).exists())


class ResourceCoverCleanupTests(TestCase):
    """Replacing or deleting a resource's cover removes the old file from disk."""

    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings_override = override_settings(MEDIA_ROOT=media.name)
        settings_override.enable()
        self.addCleanup(settings_override.disable)

    def _cover(self, name):
        return SimpleUploadedFile(name, b"\x89PNG\r\n\x1a\n", content_type="image/png")

    def _resource(self):
        return AdditionalResource.objects.create(
            category="book", title="Calm", author="A", url="https://example.com", cover_image=self._cover("a.png"),
        )

    def test_replacing_the_cover_deletes_the_old_file(self):
        resource = self._resource()
        old = resource.cover_image.path
        resource.cover_image = self._cover("b.png")
        resource.save()
        self.assertFalse(Path(old).exists())
        self.assertTrue(Path(resource.cover_image.path).exists())

    def test_saving_without_changing_the_cover_keeps_it(self):
        resource = self._resource()
        resource.title = "Calmer"
        resource.save()
        self.assertTrue(Path(resource.cover_image.path).exists())

    def test_deleting_the_resource_deletes_its_cover(self):
        resource = self._resource()
        path = resource.cover_image.path
        resource.delete()
        self.assertFalse(Path(path).exists())

    def test_a_row_deleted_before_saving_is_fine(self):
        resource = self._resource()
        AdditionalResource.objects.filter(pk=resource.pk).delete()
        resource.title = "Back again"
        resource.save()  # no error
