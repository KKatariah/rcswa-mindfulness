"""Example forum data for trying out Admin → Moderation.

Creates a handful of demo students (emails ending @moderation-demo.test) with threads,
replies, open reports, removed posts and forum bans, so every tab and state of the
Moderation page has something in it. For development and testing only.

Safe to re-run: each run deletes the previous demo data first, so it also resets
anything you dismissed, hid or banned while testing. --clear only deletes it.

Usage:
    python manage.py seed_moderation
    python manage.py seed_moderation --clear
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from app.models import Cohort, Enrollment, ForumFlag, ForumPost, ForumThread, User

DEMO_DOMAIN = "moderation-demo.test"
DEMO_COHORT = "Moderation demo"

# key: (full name, display name)
DEMO_USERS = {
    "priya": ("Priya Shah", "Priya"),
    "sam": ("Sam Taylor", ""),
    "jordan": ("Jordan Lee", "JL"),
    "alex": ("Alex Morgan", "Alex M"),
    "casey": ("Casey Nguyen", ""),
}


def _demo_users():
    return User.objects.filter(email__endswith=f"@{DEMO_DOMAIN}")


class Command(BaseCommand):
    help = "Create example reported posts, removed posts and bans for the Moderation page. Re-running resets them."

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Only delete the demo data.")

    def handle(self, *args, **options):
        with transaction.atomic():
            self._clear()
            if options["clear"]:
                self.stdout.write(self.style.SUCCESS("Deleted the moderation demo data."))
                return
            self._seed()
        self.stdout.write(self.style.SUCCESS(
            "Created moderation demo data: 5 reported posts, 4 removed posts and 2 banned users. "
            f"The demo students (@{DEMO_DOMAIN}) have no password; they exist to fill the admin views."
        ))

    def _clear(self):
        users = _demo_users()
        # Threads outlive their author (SET_NULL), so remove the demo ones explicitly.
        ForumThread.objects.filter(created_by__in=users).delete()
        users.delete()
        Cohort.objects.filter(name=DEMO_COHORT, enrollments__isnull=True).delete()

    def _seed(self):
        now = timezone.now()
        today = timezone.localdate()
        admin = User.objects.filter(role=User.Role.ADMIN).order_by("pk").first()

        cohort = Cohort.objects.filter(start_date__lte=today, end_date__gte=today).order_by("start_date").first()
        if cohort is None:
            cohort = Cohort.objects.create(
                name=DEMO_COHORT, year=today.year,
                start_date=today - timedelta(days=14), end_date=today + timedelta(days=42),
            )

        u = {}
        for key, (full_name, display_name) in DEMO_USERS.items():
            user = User.objects.create_user(
                email=f"{key}@{DEMO_DOMAIN}", password=None, full_name=full_name, display_name=display_name,
            )
            user.forum_rules_accepted_at = now - timedelta(days=10)
            user.save(update_fields=["forum_rules_accepted_at"])
            Enrollment.objects.create(user=user, cohort=cohort, status=Enrollment.Status.ACTIVE)
            u[key] = user

        def ago(**kwargs):
            return now - timedelta(**kwargs)

        def thread(author, body, when):
            t = ForumThread.objects.create(created_by=author, title=body[:60].rsplit(" ", 1)[0], cohort=cohort)
            head = post(t, author, body, when, head=True)
            t.opened_by = head
            t.save(update_fields=["opened_by"])
            return t, head

        def post(t, author, body, when, head=False):
            p = ForumPost.objects.create(thread=t, author=author, body=body, is_head_post=head)
            # created_at is auto_now_add, so back-date it afterwards.
            ForumPost.objects.filter(pk=p.pk).update(created_at=when)
            ForumThread.objects.filter(pk=t.pk).update(updated_at=when)
            return p

        def flag(p, by, reason, when, resolution="", resolved_by=None):
            f = ForumFlag.objects.create(
                post=p, flagged_by=by, reason=reason, resolution=resolution,
                resolved_at=when + timedelta(hours=2) if resolution else None, resolved_by=resolved_by,
            )
            ForumFlag.objects.filter(pk=f.pk).update(created_at=when)

        def remove(p, by, when):
            ForumPost.objects.filter(pk=p.pk).update(is_deleted=True, deleted_at=when, deleted_by=by)

        # ── Reported ───────────────────────────────────────────────────────────
        # A normal thread with a rude reply (two reports) and a spam reply (no reason given).
        t1, _ = thread(
            u["priya"],
            "Struggling to find time for the evening practice. Has anyone found a routine that works "
            "with young kids at home?",
            ago(days=3),
        )
        post(t1, u["sam"], "I do mine in the car before I walk in the door. Ten minutes is plenty.", ago(days=3, hours=-2))
        rude = post(
            t1, u["jordan"],
            "If you can't find 20 minutes a day you're not trying. Stop making excuses and just do it.",
            ago(days=2, hours=20),
        )
        flag(rude, u["priya"], "Unkind and dismissive.", ago(days=2, hours=18))
        flag(rude, u["sam"], "Personal attack on another student.", ago(days=2, hours=6))
        spam = post(
            t1, u["jordan"],
            "Want to focus better? DM me for discount supplements, 50% off this week only!!!",
            ago(days=1, hours=5),
        )
        flag(spam, u["sam"], "", ago(days=1, hours=4))

        # A whole thread reported through its opening post.
        _, scam_head = thread(
            u["jordan"],
            "Honestly this whole mindfulness thing is a scam and anyone who says it helps is lying to themselves.",
            ago(days=1, hours=2),
        )
        flag(scam_head, u["priya"], "Dismisses everyone's experience. Against rule 5.", ago(hours=20))

        # A reply that shares someone else's private details.
        t3, _ = thread(
            u["sam"],
            "Sharing what helped me in week 2: doing the body scan lying on the floor instead of in bed.",
            ago(days=4),
        )
        private = post(
            t3, u["priya"],
            "Same! My colleague from the ward found it hard too. She said I could share her number if "
            "anyone wants to chat: 0412 345 678.",
            ago(hours=9),
        )
        flag(private, u["sam"], "Shares another person's phone number.", ago(hours=3))

        # A reported reply its author has since deleted, so the queue shows "Removed by its author".
        regret = post(t3, u["jordan"], "Body scans are for people with nothing better to do.", ago(days=2))
        flag(regret, u["priya"], "Mocking people.", ago(days=1, hours=22))
        remove(regret, u["jordan"], ago(days=1, hours=12))

        # ── Removed (no open reports) ─────────────────────────────────────────
        oops = post(t3, u["sam"], "Sorry, posted this twice by mistake.", ago(days=3, hours=23))
        remove(oops, u["sam"], ago(days=3, hours=22))

        # Alex's thread, hidden by a moderator after a report, and Alex banned for 7 days.
        _, rant_head = thread(
            u["alex"],
            "The facilitator in week 1 had no idea what they were talking about. Total waste of time.",
            ago(days=6),
        )
        flag(rant_head, u["priya"], "Insulting the facilitator.", ago(days=5, hours=20),
             resolution=ForumFlag.Resolution.BANNED, resolved_by=admin)
        remove(rant_head, admin, ago(days=5, hours=18))

        # Casey's reply, hidden by a moderator; Casey banned until lifted.
        insult = post(t1, u["casey"], "Nobody cares about your kids, Priya.", ago(days=2, hours=1))
        flag(insult, u["priya"], "Targeting me personally.", ago(days=2),
             resolution=ForumFlag.Resolution.BANNED, resolved_by=admin)
        remove(insult, admin, ago(days=1, hours=23))

        # ── Bans ───────────────────────────────────────────────────────────────
        User.objects.filter(pk=u["alex"].pk).update(
            forum_banned_at=ago(days=5, hours=18), forum_banned_until=ago(days=5, hours=18) + timedelta(days=7),
        )
        User.objects.filter(pk=u["casey"].pk).update(forum_banned_at=ago(days=1, hours=23), forum_banned_until=None)
