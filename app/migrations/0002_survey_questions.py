from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="survey",
            name="questions",
            field=models.JSONField(default=list),
        ),
    ]
