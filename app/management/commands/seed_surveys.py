"""Backfill: ensure every module has exactly one weekly survey.

Safe to re-run — uses get_or_create so existing surveys (including ones loaded
from the weekly_survey.json fixture with codes like "weekly-maq-w1") are
recognised and skipped.

Usage:
    python manage.py seed_surveys
"""

from django.core.management.base import BaseCommand

from app.models import Module, Survey, SurveyType
from app.survey_template import STANDARD_WEEKLY_QUESTIONS


class Command(BaseCommand):
    help = "Ensure every module has one weekly survey. Safe to re-run."

    def handle(self, *args, **options):
        created_count = 0
        skipped_count = 0

        for module in Module.objects.order_by("week_number"):
            _survey, created = Survey.objects.get_or_create(
                module=module,
                type=SurveyType.WEEKLY,
                defaults={
                    "code": f"weekly-w{module.week_number}",
                    "title": f"Week {module.week_number}",
                    "questions": STANDARD_WEEKLY_QUESTIONS,
                },
            )
            if created:
                created_count += 1
                self.stdout.write(f"  Created survey for Week {module.week_number} ({module.title})")
            else:
                skipped_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Created {created_count} survey(s); "
                f"{skipped_count} module(s) already had one."
            )
        )
