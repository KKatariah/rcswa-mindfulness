from django.apps import AppConfig


class ProgramConfig(AppConfig):
    name = 'app'

    def ready(self):
        import app.signals  # noqa: F401 — registers post_save handlers
