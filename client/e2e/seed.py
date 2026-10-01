# Seeds the throwaway e2e database. Run via: python manage.py shell < client/e2e/seed.py
from datetime import timedelta

from django.core.management import call_command
from django.utils import timezone

from app.models import Cohort, ContentCompletion, ContentItem, Enrollment, Module, User

PASSWORD = "Calm-River-42"

call_command("loaddata", "dev_seed", "weekly_survey", verbosity=0)

today = timezone.localdate()
# Started a week ago: weeks 1-2 are open, week 3 opens in 7 days.
cohort = Cohort.objects.create(
    name="E2E Cohort", year=today.year,
    start_date=today - timedelta(days=7), end_date=today + timedelta(days=60),
)
Module.objects.filter(week_number=2).update(is_published=True)
Module.objects.create(week_number=3, title="Week 3 (locked)", is_published=True)

student = User.objects.create_user(email="student@e2e.local", password=PASSWORD, full_name="E2E Student")
other = User.objects.create_user(email="other@e2e.local", password=PASSWORD, full_name="E2E Other")
User.objects.create_user(email="admin@e2e.local", password=PASSWORD, full_name="E2E Admin", role=User.Role.ADMIN)
for user in (student, other):
    Enrollment.objects.create(user=user, cohort=cohort, status=Enrollment.Status.ACTIVE)

# Finishing week 1's content unlocks the week 1 survey.
for item in ContentItem.objects.filter(module__week_number=1):
    ContentCompletion.objects.create(user=student, content_item=item)

print("e2e seed complete")
