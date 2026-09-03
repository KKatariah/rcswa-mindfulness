import datetime

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0002_survey_questions"),
    ]

    operations = [
        migrations.AddField(
            model_name="contentitem",
            name="day_offset",
            field=models.PositiveSmallIntegerField(
                blank=True,
                null=True,
                help_text=(
                    "Day within the module's week (0 = first day). "
                    "Null = never scheduled; no reminder will fire. "
                    "Due date = cohort.start_date + timedelta((week_number-1)*7 + day_offset)."
                ),
            ),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="push_denied",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Set by the frontend when Notification.permission === 'denied'. "
                    "When True, no push is attempted and no email fallback fires."
                ),
            ),
        ),
        migrations.AlterField(
            model_name="notificationpreference",
            name="reminder_time",
            field=models.TimeField(
                default=datetime.time(8, 0),
                help_text="Preferred send hour (Australia/Perth). Command uses hourly cron.",
            ),
        ),
        migrations.CreateModel(
            name="PushSubscription",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("endpoint", models.TextField(unique=True)),
                ("p256dh", models.TextField()),
                ("auth", models.TextField()),
                ("user_agent", models.CharField(blank=True, max_length=500)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_seen", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="push_subscriptions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
    ]
