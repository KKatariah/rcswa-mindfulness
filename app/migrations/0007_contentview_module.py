import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("app", "0006_contentview"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="contentview",
            name="unique_view_user_content_item",
        ),
        migrations.RemoveField(
            model_name="contentview",
            name="content_item",
        ),
        migrations.AddField(
            model_name="contentview",
            name="module",
            field=models.ForeignKey(
                default=1,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="views",
                to="app.module",
            ),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name="contentview",
            name="user",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="module_views",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddConstraint(
            model_name="contentview",
            constraint=models.UniqueConstraint(fields=("user", "module"), name="unique_view_user_module"),
        ),
    ]
