# Deployment (Docker)

The server needs only [`docker-compose.yml`](docker-compose.yml) and a `.env`. GitHub Actions builds the images and publishes them as public images on GHCR, so no registry login is needed.

```
TLS proxy ── proxy :8080 (Caddy) ─┬─ /api /django-admin /static /media ── api  (Django + gunicorn, :8000)
                                  └─ everything else            ── web  (Next.js standalone, :3000)
cron        same image as api; supercronic runs the two hourly notification commands
watchtower  polls GHCR, redeploys api/web/cron on a new :latest
appdata     named volume: SQLite DB and uploaded media, mounted at /data
```

- Only `proxy` publishes a port: `${HTTP_PORT:-8080}`, plain HTTP. TLS terminates at your proxy, which must preserve `Host` and set `X-Forwarded-Proto`. Django trusts `X-Forwarded-*` (`BEHIND_PROXY=True`), so don't expose 8080 beyond that proxy.
- The images run as non-root. The `api` container runs `migrate` on every start.
- Requirements: Docker Engine with Compose v2.23+, because the Caddyfile is inlined through `configs.content`. Podman isn't supported, since Watchtower needs `/var/run/docker.sock`.
- On SELinux hosts, Watchtower runs with `label:disable` so it can use the socket. Nothing else relaxes SELinux. Watchtower only acts on containers labelled `com.centurylinklabs.watchtower.enable=true`.

## Setup

```bash
REPO=https://raw.githubusercontent.com/KKatariah/rcswa-mindfulness/main
curl -fsSLO $REPO/docker-compose.yml -O $REPO/.env.example
cp .env.example .env && chmod 600 .env   # then fill in
docker compose up -d
docker compose exec api python manage.py seed_site
```

`.env` (every variable is annotated in `.env.example`):

| Variable                                                                          | Notes                                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DJANGO_SECRET_KEY`                                                               | Required; the container won't start without it. Rotating it invalidates sessions.                                                                 |
| `ALLOWED_HOSTS`                                                                   | Public hostname(s). Keep `localhost`, because the container healthcheck uses it.                                                                  |
| `CSRF_TRUSTED_ORIGINS`                                                            | `https://<hostname>`                                                                                                                              |
| `SECURE_COOKIES`                                                                  | `True` over HTTPS. HTTPS is needed in dev too, since service workers and push require a secure context.                                           |
| `GOOGLE_CLIENT_ID`                                                                | Must match the ID baked into the `web` image (see below).                                                                                         |
| `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` / `VAPID_ADMIN_EMAIL`                    | Web push. Generate once with `python -m pywebpush --info` or see README §1. Keep these stable: changing them orphans existing push subscriptions. |
| `IMAGE_TAG`                                                                       | `latest` (auto-update) or `sha-<7>` to pin.                                                                                                       |
| `UPDATE_POLL_SECONDS`, `GUNICORN_WORKERS`, `LOG_LEVEL`, `SENTRY_DSN`, `HTTP_PORT` | Optional.                                                                                                                                         |

`seed_site` imports the introduction and the eight weekly modules (unpublished; pass `--publish` to publish them), creates a weekly survey for weeks 1–8, and prompts for the first admin. Without a TTY it reads `DJANGO_SUPERUSER_EMAIL`, `DJANGO_SUPERUSER_FULL_NAME` and `DJANGO_SUPERUSER_PASSWORD` instead. It's idempotent: modules are imported only into an empty database, and no admin is created if one already exists.

**Google sign-in:** add each site origin to the OAuth client's Authorised JavaScript origins. The frontend's client ID is a build-time value, set by the `NEXT_PUBLIC_GOOGLE_CLIENT_ID` Actions variable on the repo.

## Updates and rollback

A merge to `main` runs the backend and frontend CI. If both pass, it publishes `:latest` and `:sha-<7>` for both images ([api](https://github.com/KKatariah/rcswa-mindfulness/pkgs/container/rcswa-mindfulness-api), [web](https://github.com/KKatariah/rcswa-mindfulness/pkgs/container/rcswa-mindfulness-web)). Watchtower then redeploys within `UPDATE_POLL_SECONDS`. Because the API runs migrations on start, an auto-update can change the schema.

**Production:** we suggest auto-updating only dev. On prod, pin `IMAGE_TAG` to the `sha-` tag verified in dev, and promote with `docker compose up -d` after taking a backup.

Rollback: set `IMAGE_TAG=sha-<7>`, then run `docker compose up -d`. Migrations aren't reversed, so rolling back past a schema change needs the matching DB backup.

`docker-compose.yml` itself isn't managed by Watchtower. Re-fetch it from the repo when it changes.

## Backups

All state lives in the `appdata` volume. The DB is SQLite, so use the online backup API rather than copying the file:

```bash
docker compose exec api sqlite3 /data/db.sqlite3 ".backup /data/backup.sqlite3"
docker compose cp api:/data/backup.sqlite3 ./db-$(date +%F).sqlite3
docker compose cp api:/data/media ./media-$(date +%F)
```

To restore, stop `api` and `cron`, replace `/data/db.sqlite3`, then start them again. Nothing schedules backups yet.

## Operations

- Health: `GET /api/health/` returns `{"status": "ok"}`. The `api` service has a compose healthcheck, and `cron` waits for it.
- Management commands: `docker compose exec api python manage.py <command>` (README §6). `send_due_reminders --verify` checks the reminder configuration.
- Cron schedules are in UTC (`deploy/crontab` in the image).
- Every service logs to stdout/stderr (`docker compose logs`).

## For repository maintainers

- GHCR creates packages as private even when the repo is public. After the first publish, set both packages to **Public** under Package settings, or anonymous pulls fail with `denied`. This can't be undone.
- Secrets exist only in each server's `.env`. They are git-ignored and kept out of build contexts by `.dockerignore`. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is a variable, not a secret, because it ships in the frontend bundle.
- Only pushes to `main` publish. Pull requests from forks get a read-only token.

## Building locally

```bash
cp .env.example .env    # DJANGO_SECRET_KEY, ALLOWED_HOSTS=localhost, SECURE_COOKIES=False
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

This serves the app at <http://localhost:8080>, built from the checkout, without Watchtower.
