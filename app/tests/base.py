"""Shared test base classes and fixtures."""

import datetime
import json
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase as DjangoTestCase
from rest_framework.test import APITestCase as DRFAPITestCase

from ..models import Cohort, ContentItem, Enrollment, Module, Survey


User = get_user_model()


class _ClearCacheMixin:
    """Rate-limit counters live in the cache, which Django does not reset between tests."""

    def _pre_setup(self):
        super()._pre_setup()
        cache.clear()


class TestCase(_ClearCacheMixin, DjangoTestCase):
    pass


class APITestCase(_ClearCacheMixin, DRFAPITestCase):
    pass


def _enroll(*users):
    """Put users in an active cohort that started a year ago, so every module week is unlocked."""
    today = date.today()
    cohort = Cohort.objects.create(
        name="Enrolled Cohort", year=today.year,
        start_date=today - timedelta(days=365), end_date=today + timedelta(days=365),
    )
    for user in users:
        Enrollment.objects.create(user=user, cohort=cohort, status=Enrollment.Status.ACTIVE)


def _make_user(email, password="pw"):
    return User.objects.create_user(email=email, password=password)


def _make_cohort(name="C1", days_ago=7, duration=56):
    today = datetime.date.today()
    start = today - datetime.timedelta(days=days_ago)
    return Cohort.objects.create(
        name=name, year=today.year, start_date=start, end_date=start + datetime.timedelta(days=duration)
    )


def _make_module(week=1, published=True):
    return Module.objects.create(week_number=week, title=f"Week {week}", is_published=published)


def _make_audio_item(module, title="Meditation", display_order=1):
    return ContentItem.objects.create(
        module=module, title=title, type="audio", provider="soundcloud",
        embed_url="https://soundcloud.com/x/y", display_order=display_order,
    )


def _perth_midnight_utc(date):
    """Reproduce the command's formula so tests don't import from the command."""
    from zoneinfo import ZoneInfo
    from datetime import timezone as stdlib_tz
    PERTH_TZ = ZoneInfo("Australia/Perth")
    return datetime.datetime.combine(date, datetime.time.min, tzinfo=PERTH_TZ).astimezone(stdlib_tz.utc)


def _drop_auto_surveys(*modules):
    """Remove the weekly surveys auto-created for these modules so a test can create its own."""
    Survey.objects.filter(module__in=modules, type=Survey.SurveyType.WEEKLY).delete()


def _cohort(days_since_start, length_days=60):
    from django.utils import timezone
    today = timezone.localdate()
    return Cohort.objects.create(
        name=f"Cohort {days_since_start}", year=today.year,
        start_date=today - timedelta(days=days_since_start),
        end_date=today - timedelta(days=days_since_start) + timedelta(days=length_days),
    )


def _pushed_titles(mock_push):
    """(title, url) of every push a patched pywebpush.webpush was asked to send."""
    return [(json.loads(c.kwargs["data"])["title"], json.loads(c.kwargs["data"])["url"]) for c in mock_push.call_args_list]
