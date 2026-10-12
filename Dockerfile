# Django API image. Also used by the `cron` service (docker-compose.yml), which runs
# the scheduled notification commands with supercronic instead of gunicorn.
# Holds no secrets: everything comes from the .env file at runtime (see .env.example).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Cron runner for containers: logs to stdout and needs no root or syslog.
# Checksums from https://github.com/aptible/supercronic/releases/tag/v0.2.49
ARG TARGETARCH=amd64
ARG SUPERCRONIC_VERSION=v0.2.49
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl sqlite3; \
    rm -rf /var/lib/apt/lists/*; \
    case "$TARGETARCH" in \
      amd64) sha=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1 ;; \
      arm64) sha=02aa0cb229ba09050cba6638059dadb9eedc2276632ea43d6a57a2f8c1629dd5 ;; \
      *) echo "unsupported arch $TARGETARCH"; exit 1 ;; \
    esac; \
    curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH}"; \
    echo "$sha  /usr/local/bin/supercronic" | sha256sum -c -; \
    chmod +x /usr/local/bin/supercronic

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY manage.py .
COPY server/ server/
COPY app/ app/
COPY deploy/entrypoint.sh deploy/crontab /app/deploy/

# The admin's CSS/JS, served by WhiteNoise. The throwaway key only exists for this step.
RUN DJANGO_DEBUG=False DJANGO_SECRET_KEY=collectstatic-only python manage.py collectstatic --noinput

# The database and uploads live on volumes mounted at /data (docker-compose.yml).
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /data/media \
    && chown -R app:app /data
USER app

ENV DJANGO_DB_PATH=/data/db.sqlite3 \
    MEDIA_ROOT=/data/media

EXPOSE 8000
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["web"]
