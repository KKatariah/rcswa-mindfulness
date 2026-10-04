from django.db import migrations, models
from django.db.models import Count


def check_no_duplicate_weekly_surveys(apps, schema_editor):
    """Fail fast with a helpful message if duplicates already exist."""
    Survey = apps.get_model("app", "Survey")
    duplicates = (
        Survey.objects
        .filter(type="weekly", module__isnull=False)
        .values("module_id")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
    )
    if duplicates.exists():
        module_ids = list(duplicates.values_list("module_id", flat=True))
        raise Exception(
            f"Cannot add constraint 'unique_weekly_survey_per_module': "
            f"module IDs {module_ids} already have multiple weekly surveys. "
            "Delete the duplicates manually before running this migration."
        )


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0016_merge_20260930_0856"),
    ]

    operations = [
        migrations.RunPython(
            check_no_duplicate_weekly_surveys,
            migrations.RunPython.noop,
        ),
        migrations.AlterModelOptions(
            name="survey",
            options={"ordering": ["module__week_number"]},
        ),
        migrations.AddConstraint(
            model_name="survey",
            constraint=models.UniqueConstraint(
                condition=models.Q(type="weekly"),
                fields=["module"],
                name="unique_weekly_survey_per_module",
            ),
        ),
    ]
