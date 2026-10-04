"""Import the reviewed RCSWA document content without duplicate modules or media."""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from app.models import ContentItem, Module


# Only these known development-fixture items may be replaced in place.
PLACEHOLDERS = {
    "https://www.youtube.com/embed/ZToicYcHIOU",
    "https://soundcloud.com/mindfulness-exercises/mindful-breathing",
    "https://www.youtube.com/embed/QS2yDmWk0vs",
    "https://soundcloud.com/mindfulness-exercises/body-scan",
}


class Command(BaseCommand):
    help = "Import the RCSWA introduction and eight weekly modules; preserve existing publication flags and learner records."

    def add_arguments(self, parser):
        parser.add_argument("--publish", action="store_true", help="Publish the imported modules.")
        parser.add_argument("--dry-run", action="store_true", help="Validate and preview without saving changes.")

    def handle(self, *args, **options):
        path = Path(__file__).resolve().parents[2] / "content" / "rcswa_modules.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        if [row["week_number"] for row in data["modules"]] != list(range(0, 9)):
            raise CommandError("Expected exactly weeks 0–8.")

        with transaction.atomic():
            for row in data["modules"]:
                module, _ = Module.objects.get_or_create(week_number=row["week_number"])
                module.title = row["title"]
                module.description = row["description"]
                module.summary = row["summary"]
                if options["publish"]:
                    module.is_published = True
                module.full_clean()
                module.save()

                for order, media in enumerate(row["content_items"], start=1):
                    item = module.content_items.filter(embed_url=media["embed_url"]).first()
                    if item is None:
                        candidates = list(module.content_items.filter(
                            provider=media["provider"], embed_url__in=PLACEHOLDERS,
                        ))
                        if len(candidates) > 1:
                            raise CommandError(f"Multiple placeholder items in week {module.week_number}; review manually.")
                        if candidates:
                            item = candidates[0]
                            if item.completions.exists() or item.forum_threads.exists() or item.notification_logs.exists():
                                raise CommandError(f"Placeholder item {item.pk} has learner history; import cancelled.")
                        else:
                            item = ContentItem(module=module)

                    item.title = media["title"]
                    item.type = media["type"]
                    item.provider = media["provider"]
                    item.embed_url = media["embed_url"]
                    item.display_order = order
                    item.full_clean()
                    item.save()
                self.stdout.write(f"{module.week_label}: {module.title} ({len(row['content_items'])} media items)")

            if options["dry_run"]:
                transaction.set_rollback(True)
                self.stdout.write("Dry run: no changes saved.")
            else:
                self.stdout.write(self.style.SUCCESS(
                    f"Imported {len(data['modules'])} modules and "
                    f"{sum(len(row['content_items']) for row in data['modules'])} media items."
                ))
