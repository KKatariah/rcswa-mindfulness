from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0003_forum_thread_is_pinned"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="display_name",
            field=models.CharField(blank=True, max_length=100, default=""),
            preserve_default=False,
        ),
    ]
