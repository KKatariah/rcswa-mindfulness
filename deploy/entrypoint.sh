#!/bin/sh
# Starts the API image in one of two roles (docker-compose.yml picks with `command:`):
#   web   apply any new migrations, then serve the API with gunicorn
#   cron  run the scheduled notification commands in deploy/crontab
# Anything else runs as a command, e.g. `docker compose run --rm api python manage.py shell`.
set -e

case "$1" in
  web)
    python manage.py migrate --noinput
    exec gunicorn server.wsgi:application \
      --bind 0.0.0.0:8000 \
      --workers "${GUNICORN_WORKERS:-3}" \
      --access-logfile - \
      --forwarded-allow-ips '*'
    ;;
  cron)
    exec supercronic /app/deploy/crontab
    ;;
  *)
    exec "$@"
    ;;
esac
