from django.core.management.base import BaseCommand
from django.utils import timezone

from app.models import Enrollment, Module, NotificationLog
from app.notifications import deliver


class Command(BaseCommand):
    help = (
        "Send notifications for published modules whose unlock time has passed. "
        "Safe to run repeatedly because successful notifications are not resent."
    )

    def handle(self, *args, **options):
        now = timezone.now()

        # Process scheduled modules that are already available.
        # Modules with unlock_at=None are immediately available rather than
        # scheduled unlock events, so they are not handled by this command.
        modules = Module.objects.filter(
            is_published=True,
            unlock_at__isnull=False,
            unlock_at__lte=now,
        )

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

                payload = {
                    "title": f"Week {module.week_number} is now available",
                    "body": module.title,
                    "url": f"/modules/{module.week_number}/",
                }

                channel, success = deliver(
                    user=user,
                    payload_dict=payload,
                    subject=f"Week {module.week_number} is now available",
                    email_template="app/content_update_email.txt",
                    email_context={
                        "user": user,
                        "module": module,
                    },
                )

                NotificationLog.objects.create(
                    user=user,
                    type=NotificationLog.NotificationType.MODULE_ADDED,
                    module=module,
                    channel=channel or NotificationLog.Channel.PUSH,
                    scheduled_for=module.unlock_at,
                    sent_at=now if success else None,
                    status=(
                        NotificationLog.Status.SENT
                        if success
                        else NotificationLog.Status.FAILED
                    ),
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
