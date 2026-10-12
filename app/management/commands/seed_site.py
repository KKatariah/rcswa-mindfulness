"""First-time setup for a new server including modules, weekly surveys and an admin account.

Command is safe to re-run, modules are imported only into an empty site, existing surveys
are kept, and no admin is created once one exists.

Usage (Docker, DEPLOYMENT.md):
    docker compose exec api python manage.py seed_site [--publish]

Prompts for the admin's email, name and password. Without a terminal it reads
DJANGO_SUPERUSER_EMAIL, DJANGO_SUPERUSER_FULL_NAME and DJANGO_SUPERUSER_PASSWORD.

Don't use the weekly_survey fixture here because it attaches surveys by fixed module ID,
which after this import is the week 0 introduction.
"""

import sys

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand

from app.models import Module, Survey, SurveyType
from app.survey_template import STANDARD_WEEKLY_QUESTIONS


class Command(BaseCommand):
    help = "Seed a new site with the RCSWA modules, their weekly surveys and one admin account. Safe to re-run."

    def add_arguments(self, parser):
        parser.add_argument("--publish", action="store_true", help="Publish the modules as they are imported.")

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("Modules"))
        # Only into an empty site: re-importing would overwrite admins' edits to the
        # modules and, once published, notify students of a content update.
        if Module.objects.exists():
            self.stdout.write("Modules already exist; not re-imported.")
        else:
            call_command("import_rcswa_modules", publish=options["publish"], stdout=self.stdout)

        # New modules get their survey automatically (app/signals.py); this covers modules
        # that existed before. Like the signal, it skips the week 0 introduction
        # (seed_surveys doesn't, so it isn't used here).
        self.stdout.write(self.style.MIGRATE_HEADING("Weekly surveys"))
        created = 0
        for module in Module.objects.filter(week_number__gte=1):
            _survey, was_created = Survey.objects.get_or_create(
                module=module,
                type=SurveyType.WEEKLY,
                defaults={
                    "code": f"weekly-w{module.week_number}",
                    "title": f"Week {module.week_number}",
                    "questions": STANDARD_WEEKLY_QUESTIONS,
                },
            )
            created += was_created
        self.stdout.write(f"Every week after the introduction has a weekly survey ({created} created now).")

        self.stdout.write(self.style.MIGRATE_HEADING("Admin account"))
        admin = get_user_model().objects.filter(is_superuser=True).first()
        if admin:
            self.stdout.write(f"An admin already exists ({admin.email}); none created.")
        else:
            call_command("createsuperuser", interactive=sys.stdin.isatty(), stdout=self.stdout)

        if Module.objects.filter(is_published=False).exists():
            self.stdout.write(self.style.WARNING(
                "Some modules are unpublished: publish them in the admin dashboard, or re-run with --publish."
            ))
        self.stdout.write(self.style.SUCCESS("Seeding complete."))
