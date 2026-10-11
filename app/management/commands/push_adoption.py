"""push_adoption — report push notification adoption per active cohort.

Outputs, per active cohort:
  - Number of active enrollments
  - Number of those users with at least one live PushSubscription
  - Adoption percentage

Usage:
    python manage.py push_adoption
    python manage.py push_adoption --csv    # machine-readable output
"""

import csv
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand
from django.utils import timezone

from app.models import Cohort, Enrollment, PushSubscription

PERTH_TZ = ZoneInfo("Australia/Perth")


class Command(BaseCommand):
    help = "Report web-push adoption per active cohort."

    def add_arguments(self, parser):
        parser.add_argument(
            "--csv",
            action="store_true",
            help="Output as CSV instead of human-readable text.",
        )

    def handle(self, *args, **options):
        today = timezone.now().astimezone(PERTH_TZ).date()

        active_cohorts = (
            Cohort.objects
            .filter(
                end_date__gte=today,
                enrollments__status=Enrollment.Status.ACTIVE,
            )
            .distinct()
            .order_by("year", "name")
        )

        if not active_cohorts.exists():
            self.stdout.write("No active cohorts.")
            return

        rows = []
        for cohort in active_cohorts:
            enrolled_user_ids = set(
                Enrollment.objects
                .filter(cohort=cohort, status=Enrollment.Status.ACTIVE)
                .values_list("user_id", flat=True)
            )
            total = len(enrolled_user_ids)
            if total == 0:
                continue

            with_push = PushSubscription.objects.filter(
                user_id__in=enrolled_user_ids
            ).values("user_id").distinct().count()

            pct = round(with_push / total * 100, 1) if total else 0.0
            rows.append({
                "cohort": str(cohort),
                "active_enrollments": total,
                "users_with_push": with_push,
                "adoption_pct": pct,
            })

        if options["csv"]:
            writer = csv.DictWriter(
                self.stdout,
                fieldnames=["cohort", "active_enrollments", "users_with_push", "adoption_pct"],
            )
            writer.writeheader()
            writer.writerows(rows)
        else:
            self.stdout.write(
                f"{'Cohort':<40} {'Enrolled':>10} {'With Push':>10} {'Adoption':>10}"
            )
            self.stdout.write("-" * 74)
            for r in rows:
                self.stdout.write(
                    f"{r['cohort']:<40} {r['active_enrollments']:>10} "
                    f"{r['users_with_push']:>10} {r['adoption_pct']:>9.1f}%"
                )
