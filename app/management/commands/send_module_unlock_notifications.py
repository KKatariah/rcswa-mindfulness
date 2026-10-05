from datetime import datetime, time

from django.core.management.base import BaseCommand
from django.utils import timezone

from app.models import Enrollment, Module, NotificationLog
from app.access import module_unlock_date
from app.notifications import deliver_and_log


class Command(BaseCommand):
    help = (
        "Notify active participants about published modules that unlock for them today. "
        "Safe to run repeatedly because successful notifications are not resent."
    )

    def handle(self, *args, **options):
        today = timezone.localdate()

        # Unlock dates are per user (cohort start + (week - 1) weeks), so each
        # enrollment is checked individually. Only modules unlocking today are
        # announced, so the first run does not notify about every past week.
        modules = Module.objects.filter(is_published=True)

        sent = 0
        skipped = 0
        failed = 0

        enrollments = (
            Enrollment.objects
            .filter(status=Enrollment.Status.ACTIVE)
            .select_related(
                "user",
                "cohort",
                "user__notification_preference",
            )
        )

        for module in modules:
            for enrollment in enrollments:
                user = enrollment.user

                unlock_date = module_unlock_date(module, user)
                if unlock_date != today:
                    continue

                # Weeks that would open after the cohort has finished aren't announced.
                if unlock_date > enrollment.cohort.end_date:
                    continue

                # A successful notification must never be sent twice.
                # FAILED attempts remain retryable on the next command run.
                already_sent = NotificationLog.objects.filter(
                    user=user,
                    module=module,
                    type=NotificationLog.NotificationType.MODULE_ADDED,
                    status=NotificationLog.Status.SENT,
                ).exists()

                if already_sent:
                    skipped += 1
                    continue

                success = deliver_and_log(
                    user=user,
                    notification_type=NotificationLog.NotificationType.MODULE_ADDED,
                    payload_dict={
                        "title": f"{module.week_label} is now available",
                        "body": module.title,
                        "url": f"/modules/{module.id}",
                    },
                    subject=f"{module.week_label} is now available",
                    email_template="app/content_update_email.txt",
                    email_context={"user": user, "module": module},
                    module=module,
                    scheduled_for=timezone.make_aware(datetime.combine(unlock_date, time.min)),
                )

                if success:
                    sent += 1
                else:
                    failed += 1

        self.stdout.write(
            self.style.SUCCESS(
                "[send_module_unlock_notifications] "
                f"sent={sent} skipped={skipped} failed={failed}"
            )
        )
