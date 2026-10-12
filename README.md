# Online Mindfulness Training Program

A web application for an 8-week mindfulness training program for medical students.
It brings the program's mini-lectures, guided meditations, weekly reflection surveys
and a peer forum into one place, with progress tracking and push-notification reminders.

Built by **Git Buddies (Team 45)** for CITS3200 Professional Computing, Semester 2 2026.

**Stack:** Django + Django REST Framework (`app/`, `server/`) · Next.js + React (`client/`) · SQLite · Web Push (VAPID)

## Contents

- [Getting started](#getting-started)
- [Database setup](#database-setup)
- [Push notifications](#push-notifications)
- [Scheduled jobs](#scheduled-jobs)
- [Content workflow](#content-workflow)
- [Operational commands](#operational-commands)
- [Production settings](#production-settings)
- [Known limitations](#known-limitations)
- [Developer notes](#developer-notes)

---

## Getting started

Requires Python 3.12 and Node.js.

**Backend** (from the repo root):

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver        # http://127.0.0.1:8000
```

**Frontend** (in a second terminal):

```bash
cd client
npm install
npm run dev                       # http://localhost:3000
```

The client calls the API at `http://127.0.0.1:8000/api` unless `NEXT_PUBLIC_API_BASE_URL`
is set. Google sign-in needs `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (client) and
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (server). The server reads a `.env` file
in the repo root.

### Running tests

```bash
python manage.py test             # backend
cd client && npm test             # frontend unit tests (Vitest)
cd client && npm run test:e2e     # end-to-end tests (Playwright)
```

### Updating `requirements.txt` on Windows

PowerShell's `>` operator writes UTF-16LE, which breaks `pip` on Linux CI. Regenerate
the file with:

```powershell
pip freeze | Out-File -Encoding utf8 requirements.txt
```

---

## Database setup

```bash
python manage.py migrate
```

A data migration also seeds the public Resources page (books, documentaries and
online programs) with its default content.

Then load the weekly surveys:

```bash
python manage.py loaddata weekly_survey
```

`weekly_survey` adds the Week 1 and Week 2 MAQ surveys (`weekly-maq-w1`, `weekly-maq-w2`)
as surveys 1 and 2, attached to modules 1 and 2, so those modules must exist first.
On an empty database with no modules yet, load the placeholder modules at the same time:

```bash
python manage.py loaddata dev_seed weekly_survey
```

> **Warning:** don't load `dev_seed` into a database that already has data. It uses
> fixed IDs and overwrites user 1, modules 1–2 and content items 1–4.

Admins create surveys for later weeks from **Admin › Surveys › New Survey**, which
copies an existing survey's questions.

To try out **Admin › Moderation** in development, run `python manage.py seed_moderation`.
It adds demo students (`@moderation-demo.test`) with reported posts, removed posts and
forum bans. Re-running it resets that data, and `--clear` deletes it. Don't run it in
production.

---

## Push notifications

### 1. Generate a VAPID keypair (one-time)

```bash
pip install pywebpush        # installs the vapid CLI as a side effect (py-vapid)
cd /tmp                      # work in /tmp so PEM files never enter the repo
vapid --gen --applicationServerKey
```

This writes `private_key.pem` and `public_key.pem` to the working directory and
prints a line like:

```text
Application Server Key = BGFQk5VLb08…
```

That value is your `VAPID_PUBLIC_KEY`. Next, extract the raw private key as a
portable base64url string to use as `VAPID_PRIVATE_KEY`:

```bash
python3 -c "
from py_vapid import Vapid; import base64
v = Vapid.from_file('/tmp/private_key.pem')
n = v.private_key.private_numbers().private_value
print(base64.urlsafe_b64encode(n.to_bytes(32,'big')).rstrip(b'=').decode())
"
```

Store the printed string as `VAPID_PRIVATE_KEY` in your environment or secrets manager,
then delete the PEM files. No key file is needed on the server at runtime: `pywebpush`
checks `os.path.isfile()` first, and because a base64url string fails that check it is
passed to `Vapid.from_string()` instead. This also survives redeploys to an ephemeral
filesystem.

### 2. Set environment variables

| Variable            | Value                                                               |
| ------------------- | ------------------------------------------------------------------- |
| `VAPID_PRIVATE_KEY` | Raw base64url private key printed by the extraction command above   |
| `VAPID_PUBLIC_KEY`  | The `Application Server Key` printed by `vapid --gen`               |
| `VAPID_ADMIN_EMAIL` | Admin contact email, included in the VAPID `sub` claim              |

In development the `VAPID_*` variables default to empty strings and push is skipped
with a warning.

Notifications are push-only. A student with no registered device gets a
`status=SKIPPED` log entry, which is retried on the next run in the same way as a
failure.

---

## Scheduled jobs

Two commands must run on a schedule. Both are idempotent: a notification that was
sent successfully is never sent again, and failed sends are retried on the next run.

- **`send_due_reminders`** must run **every hour**. It filters users by their
  `reminder_time` preference (Perth time), so a user who chose 8 am receives their
  reminder from the run at 8 am Perth time.
- **`send_module_unlock_notifications`** tells each participant "Week N is now
  available" on the day that week unlocks for their cohort (cohort start date +
  (N − 1) weeks, Perth time). It only looks at weeks unlocking _today_, so it runs
  hourly during the day: the 7 am run sends the notices and later runs retry failures.

```cron
# Server is UTC; Australia/Perth is UTC+8 with no DST.

# Every hour; the command filters by each user's preferred reminder hour.
0 * * * * /path/to/venv/bin/python /path/to/manage.py send_due_reminders >> /var/log/mindfulness/reminders.log 2>&1

# Hourly from 7 am to 8 pm Perth (23:00–12:00 UTC).
5 23,0-12 * * * /path/to/venv/bin/python /path/to/manage.py send_module_unlock_notifications >> /var/log/mindfulness/unlocks.log 2>&1
```

---

## Content workflow

1. **Create modules and content items with `is_published = False`.** Editing
   unpublished items does not notify anyone.
2. **Give every week an audio item.** On each day of a running week, students get one
   meditation reminder for that week's first audio item. Before students are enrolled,
   check that nothing is missing:

   ```bash
   python manage.py send_due_reminders --verify
   ```

   This exits non-zero and lists any published week with no audio item.
3. **Publish the module.** Students in currently active cohorts who can already open
   that week receive a single content-update notification. Students whose cohort has
   not started, or for whom the week is still locked, are excluded; they are notified
   by `send_module_unlock_notifications` when the week opens.

---

## Operational commands

```bash
# Dry run: show who would be sent a reminder today
python manage.py send_due_reminders --dry-run

# Check schedule completeness for all active cohorts
python manage.py send_due_reminders --verify

# Push adoption report (% of enrolled students with a push subscription)
python manage.py push_adoption
python manage.py push_adoption --csv    # machine-readable output
```

---

## Production settings

| Variable                                   | Value                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `DJANGO_DEBUG`                             | `False` in production (defaults to `True` for development)                             |
| `ALLOWED_HOSTS`                            | Comma-separated hostnames. Replaces the localhost defaults                             |
| `CORS_ALLOWED_ORIGINS`                     | Comma-separated origins of the client (defaults to `localhost:3000`)                   |
| `CSRF_TRUSTED_ORIGINS`                     | Comma-separated trusted origins                                                        |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in credentials                                                             |
| `VAPID_*`                                  | See [Push notifications](#push-notifications)                                          |
| `MEDIA_ROOT`                               | Folder for uploaded cover images. Must survive redeploys (persistent volume or disk)   |
| `SERVE_MEDIA`                              | Leave unset for Django to serve `/media/`; set `False` if a reverse proxy serves it    |
| `LOG_LEVEL`                                | `INFO` by default; `WARNING` for quieter logs                                          |
| `SENTRY_DSN`                               | Optional. Reports unhandled errors (web requests and cron commands) to Sentry          |
| `SENTRY_ENVIRONMENT`                       | Optional label shown in Sentry, e.g. `production` or `staging`                         |

- Run `python manage.py collectstatic --noinput` on each deploy so the Django admin's
  CSS and JS are served by WhiteNoise when `DJANGO_DEBUG=False`.
- Logs go to the console (stderr), which gunicorn, systemd, Docker and cron all capture.
  Users appear in logs by ID, never by email. No emails, IP addresses or request bodies
  (survey answers) are sent to Sentry.
- `GET /api/health/` returns `200 {"status": "ok"}` when the API can reach its database
  and `503` otherwise. It needs no login, so point an uptime monitor at it.
- List endpoints that grow over time (`/api/users/`, `/api/enrollments/`,
  `/api/forum/threads/`) are paginated with `?limit=&offset=` (25 by default, at most
  100) and respond with `{count, next, previous, results}`.

---

## Known limitations

- **Content-update notifications are sent from a daemon thread.** If the web server
  restarts while a batch is in flight, the remaining sends are silently dropped and are
  not retried. This is acceptable at the current scale; if reliability requirements
  grow, replace the thread with a persistent task queue (e.g. Celery + Redis).
  Daily reminders are not affected: `send_due_reminders` is cron-driven and only
  `status=SENT` entries prevent re-delivery, so users left with a `status=FAILED` entry
  after a restart are retried on the next hourly run.

---

## Developer notes

### User profile

- **Frontend:** `client/src/pages/profile.tsx`
- **API client:** `changePassword()` and `updateProfile()` in `client/src/lib/api.ts`

#### Avatars (Gravatar)

- Avatar URLs are computed server-side by `gravatar_url()` in `app/utils.py`, using a
  SHA-256 hash of the user's lowercased email.
- Uses Gravatar's free, unauthenticated avatar endpoint, so no API key is needed.
  Fetching other profile fields would require one; see the
  [Gravatar documentation](https://docs.gravatar.com).

#### User payload

`GET /api/user/` and the login, register, Google login, profile update and
accept-rules endpoints all return the dict built by `_user_payload()` in `app/views.py`.

### Forum

- **Frontend:** `client/src/pages/forum.tsx`
- **Models:** `ForumThread` and `ForumPost` in `app/models.py`
- **Admin customisations:** `app/admin.py`

#### Pinning threads

- `ForumThread` has `is_pinned` (bool) and `pin_order` (int). The maximum number of
  pinned threads (currently 5) is set once by `FORUM_MAX_PINNED_THREADS` in
  `server/settings.py`; change it there rather than anywhere else.
- `ForumThreadViewSet.partial_update()` in `app/views.py` wraps the change in
  `transaction.atomic()`, detects `is_pinned` changing in the request data, and calls
  `thread.reorder_pinned_threads(1 if thread.is_pinned else None)`. A newly pinned
  thread is always inserted at position 1, shifting the others down.
- Feed ordering: `order_by("-is_pinned", "pin_order", "-updated_at")`.
- In the Django admin, the `pin_order` dropdown is limited to the number of currently
  pinned threads + 1, capped at `FORUM_MAX_PINNED_THREADS`. Validation blocks saving a
  `pin_order` on a thread that doesn't have `is_pinned` ticked.

#### Editing

- `edited_at` is separate from `created_at`, so the original post time is never
  overwritten.
- `ForumPostViewSet.perform_update()` recomputes the thread title with
  `_derive_title(post.body)` and writes it to any `ForumThread` the post opens, keeping
  the title in sync with the opening post.
- `_derive_title()` truncates to at most 60 characters at a word boundary and never
  splits an emoji or combining character.

#### Deleting

- `ForumPostViewSet.perform_destroy()` sets `is_deleted=True` (a soft delete; the row
  is kept).
- It refuses to delete a thread's opening post (`"Cannot delete the opening post.
  Delete the thread instead."`). Replies have no such restriction.
- These safeguards apply only through the website's API. Deleting a post in the Django
  admin is a permanent hard delete with neither safeguard.
- Deleting a `User` in the Django admin does not delete their posts; their threads and
  replies remain, attributed to "Deleted user".
- In the Django admin, a reply's "Parent post" field only lists posts that open a
  thread, so a reply can't be set as the parent of another reply.

#### Forum-rules gate

- The `HasAcceptedForumRules` permission class blocks non-admin users from posting,
  replying and pinning until `forum_rules_accepted_at` is set, via
  `POST /api/forum/accept-rules/`. Admins are exempt.

#### Read-only mode

- Driven by `getProgramStatus` and the `is_active` flag, which follow cohort start and
  end dates.
- If no cohort has ever been configured, the forum stays open (it fails open, not
  closed).
