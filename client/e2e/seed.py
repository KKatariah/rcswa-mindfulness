# Seeds the throwaway e2e database. Run via: python manage.py shell < client/e2e/seed.py
from datetime import timedelta

from django.core.management import call_command
from django.utils import timezone

from app.models import (
    Cohort, ContentCompletion, ContentItem, Enrollment, ForumPost, ForumThread, Module, Survey, SurveyResponse, User,
)

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

# Signups waiting on the admin Approvals page: one to approve, one to reject.
for email, name in (("approve-me@e2e.local", "Approve Me"), ("reject-me@e2e.local", "Reject Me")):
    pending = User.objects.create_user(email=email, password=PASSWORD, full_name=name)
    Enrollment.objects.create(user=pending, cohort=cohort, status=Enrollment.Status.PENDING)

# Finishing week 1's content unlocks the week 1 survey for both students.
for item in ContentItem.objects.filter(module__week_number=1):
    ContentCompletion.objects.create(user=student, content_item=item)
    ContentCompletion.objects.create(user=other, content_item=item)

# A submitted week 2 survey for the admin export test.
responder = User.objects.create_user(email="responder@e2e.local", password=PASSWORD, full_name="Rae Responder")
Enrollment.objects.create(user=responder, cohort=cohort, status=Enrollment.Status.WITHDRAWN)
SurveyResponse.objects.create(
    user=responder, survey=Survey.objects.get(code="weekly-maq-w2"),
    answers={"q1": 2, "q2": 10, "q3": 4, "q13": "Seeded reflection for export."},
)

# Data the UI fuzz test uses as templates (kept separate from what other tests consume).
fuzz_pending = User.objects.create_user(email="fuzz-pending@e2e.local", password=PASSWORD, full_name="Fuzz Pending")
Enrollment.objects.create(user=fuzz_pending, cohort=cohort, status=Enrollment.Status.PENDING)
thread = ForumThread.objects.create(created_by=other, title="Seeded thread")
opening = ForumPost.objects.create(thread=thread, author=other, body="Seeded thread", is_head_post=True)
thread.opened_by = opening
thread.save(update_fields=["opened_by"])
ForumPost.objects.create(thread=thread, author=student, body="Seeded reply")

print("e2e seed complete")
