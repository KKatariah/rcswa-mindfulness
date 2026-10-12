# CITS3200-Professional-Computing

## Push Notification Setup

### 1. Generate a VAPID keypair (one-time)

```bash
pip install pywebpush        # installs the vapid CLI as a side-effect (py-vapid)
cd /tmp                      # work in /tmp so PEM files never enter the repo
vapid --gen --applicationServerKey
```

This writes `private_key.pem` and `public_key.pem` to the working directory and
prints a line like:

```
Application Server Key = BGFQk5VLb08…
```

That printed value is your `VAPID_PUBLIC_KEY`. Now extract the raw private key as a
portable base64url string — this is what you set as `VAPID_PRIVATE_KEY`:

```bash
python3 -c "
from py_vapid import Vapid; import base64
v = Vapid.from_file('/tmp/private_key.pem')
n = v.private_key.private_numbers().private_value
print(base64.urlsafe_b64encode(n.to_bytes(32,'big')).rstrip(b'=').decode())
"
```

Store the printed string as `VAPID_PRIVATE_KEY` in your environment/secrets manager,
then delete the PEM files. `pywebpush` checks `os.path.isfile()` first; a base64url
string fails that check and is passed to `Vapid.from_string()` instead, so no file
needs to exist on the server at runtime. This survives ephemeral filesystem redeploys.

### 2. Set environment variables

| Variable            | Value                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| `VAPID_PRIVATE_KEY` | Raw base64url private key — the string printed by the extraction command above |
| `VAPID_PUBLIC_KEY`  | The `Application Server Key` printed by `vapid --gen`                          |
| `VAPID_ADMIN_EMAIL` | Your admin email (included in the VAPID `sub` claim)                           |

In development `VAPID_*` default to empty strings (push is skipped with a warning).
Notifications are push only: a student with no registered device gets a
`status=SKIPPED` log entry, which is retried on the next run like a failure.

**Windows note:** PowerShell's `>` operator writes UTF-16LE, which breaks pip on Linux
CI. Always regenerate `requirements.txt` with:

```powershell
pip freeze | Out-File -Encoding utf8 requirements.txt
```

### 3. Run migrations

```bash
python manage.py migrate
```

This also seeds the public Resources page (books/documentaries/online programs) with its default content via a data migration.

Then load the weekly surveys:

```bash
python manage.py loaddata weekly_survey
```

`weekly_survey` adds the Week 1 and Week 2 MAQ surveys (`weekly-maq-w1`, `weekly-maq-w2`)
as surveys 1 and 2, attached to modules 1 and 2, so those modules must exist first.
On an empty database with no modules yet, load the placeholder modules with them:
`python manage.py loaddata dev_seed weekly_survey`. Don't load `dev_seed` into a
database that already has data: it uses fixed IDs and overwrites user 1, modules 1–2
and content items 1–4. After that, admins create surveys for later weeks from
**Admin -> Surveys -> New Survey**, which copies an existing survey's questions.

To try out **Admin -> Moderation** in development, `python manage.py seed_moderation`
adds demo students (`@moderation-demo.test`) with reported posts, removed posts and
forum bans. Re-running it resets that data; `--clear` deletes it. Don't run it in production.

### 4. Add the cron jobs

Two commands need to run on a schedule. Both are idempotent: a notification that
was sent successfully is never sent again, and failed sends are retried on the
next run.

- `send_due_reminders` must run **every hour** — it filters each user by their
  `reminder_time` preference (Perth timezone) so a user who chose 8 am receives their
  reminder at the cron run that corresponds to 8 am Perth time.
- `send_module_unlock_notifications` tells each participant "Week N is now
  available" on the day that week unlocks for their cohort (cohort start date +
  (N − 1) weeks, Perth time). It only looks at weeks unlocking _today_, so it runs
  hourly during the day: the 7 am run sends the notices, later runs retry failures.

```cron
# Server is UTC; Australia/Perth is UTC+8 with no DST.

# Every hour; the command filters by each user's preferred reminder hour.
0 * * * * /path/to/venv/bin/python /path/to/manage.py send_due_reminders >> /var/log/mindfulness/reminders.log 2>&1

# Hourly from 7 am to 8 pm Perth (23:00–12:00 UTC).
5 23,0-12 * * * /path/to/venv/bin/python /path/to/manage.py send_module_unlock_notifications >> /var/log/mindfulness/unlocks.log 2>&1
```

### 5. Content setup workflow

1. Create modules and content items while `is_published = False`.  
   Editing unpublished items does not notify anyone.
2. Give every week an audio item. Each day of a running week, students get one
   meditation reminder for that week's first audio item. Check nothing is
   missing before students are enrolled:
   ```bash
   python manage.py send_due_reminders --verify
   ```
   This exits non-zero and lists any published week with no audio item.
3. Publish the module. Students in currently active cohorts who can already open
   that week receive a single S21 content-update notification. Students in cohorts
   that have not started yet, or for whom the week is still locked, are excluded;
   they hear about it from `send_module_unlock_notifications` when it opens.

### 6. Operational commands

```bash
# Dry-run reminders to see who would be notified today
python manage.py send_due_reminders --dry-run

# Check schedule completeness for all active cohorts
python manage.py send_due_reminders --verify

# Push adoption report (% of enrolled students with a push subscription)
python manage.py push_adoption
python manage.py push_adoption --csv    # machine-readable
```

### Known limitations

- **S21 (content-update) delivery runs in a daemon thread.** A web server restart
  while a notification batch is in flight will silently drop the remaining sends.
  There is no retry for these in-flight notifications. This is acceptable for the
  current scale; if reliability requirements increase, replace the daemon thread with
  a persistent task queue (e.g. Celery + Redis).
- **S20 (daily reminders) are unaffected by this limitation.** The `send_due_reminders`
  command is cron-driven and idempotent: a failed run retries on the next cron tick,
  and only `status=SENT` entries prevent re-delivery. A server restart during a cron
  run simply leaves the failed users with a `status=FAILED` log entry that the next
  hourly run will retry.

---

## Production server settings

These are separate from the secrets (`SECRET_KEY`, Google and VAPID keys) set up for production.

| Variable             | Value                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------- |
| `DJANGO_DEBUG`       | `False` in production (defaults to `True` for development)                             |
| `MEDIA_ROOT`         | Folder for uploaded cover images. Must survive redeploys (persistent volume or disk)   |
| `SERVE_MEDIA`        | Leave unset and Django serves `/media/`; `False` if a reverse proxy serves that folder |
| `LOG_LEVEL`          | `INFO` by default; `WARNING` for quieter logs                                          |
| `SENTRY_DSN`         | Optional. Reports unhandled errors (web requests and cron commands) to Sentry          |
| `SENTRY_ENVIRONMENT` | Optional label shown in Sentry, e.g. `production` or `staging`                         |

- Run `python manage.py collectstatic --noinput` on each deploy so the Django admin's CSS
  and JS are served (by WhiteNoise) with `DJANGO_DEBUG=False`.
- Logs go to the console (stderr); gunicorn, systemd, Docker and cron all capture it.
  Users appear in logs by id, never by email. Sentry is sent no emails, IP addresses or
  request bodies (survey answers).
- `GET /api/health/` returns `200 {"status": "ok"}` when the API can reach its database
  (`503` otherwise) and needs no login. Point an uptime monitor at it.
- List endpoints that grow over time (`/api/users/`, `/api/enrollments/`,
  `/api/forum/threads/`) are paged: `?limit=&offset=` (25 by default, at most 100), and
  respond with `{count, next, previous, results}`.

---

## User Profile

**Frontend:** client/src/pages/profile.tsx 
**API client:** changePassword and updateProfile in `client/src/lib/api.ts`

### Avatars: Gravatar
- Avatar URLs are computed server-side in `app/utils.py` (`gravatar_url()`), using an SHA-256 hash of the user's lowercased email.
- Uses only Gravatar's free, unauthenticated avatar endpoint - no API key required (We are currently only fetching profile image, but one is needed if you want to fetch more than that from a user's profile on Gravatar). See Gravatar's [documentation](https://docs.gravatar.com) if you wish to learn more about its features. 

### User payload / serialization
`GET /api/user/`, and the `login`, `register`, `Google-login`, `profile-update`, and `accept-rules` endpoints, all return a hand-built `_user_payload() dict` from `app/views.py`.

---

## Forum Features

**Frontend:** client/src/pages/forum.tsx 
**Models:** ForumThread, ForumPost in app/models.py 
**Admin customizations:** app/admin.py

### Pinning Threads
- `is_pinned` (bool) + `pin_order` (int) on `ForumThread`, governed by a shared, single-source-of-truth maximum-pinned constant (currently 5) - check its definition before changing the limit anywhere.
- `ForumThreadViewSet.partial_update()` (app/views.py) wraps the change in `transaction.atomic()`, detects `is_pinned` flipping in the incoming request data, and calls `thread.reorder_pinned_threads(1 if thread.is_pinned else None)`. A newly pinned thread is always inserted at `pin-order` position 1, shifting the rest down.
- **Feed ordering:** `order_by("-is_pinned", "pin_order", "-updated_at")`.
- **Django admin:** the `pin-order` dropdown is limited to the number of currently pinned threads (+1), capped at the site's max-pinned constant. Admin validation blocks saving `pin_order` on a thread without `is_pinned` ticked.

### Editing
- `edited_at` is a separate field from `created_at` - the original post time is never overwritten.
- `ForumPostViewSet.perform_update()` recomputes the thread title via `_derive_title(post.body)` and writes it onto any `ForumThread` this post opens, so a thread's title stays in sync with its opening post.
  - `_derive_title()` truncates to ≤60 chars at a word boundary, with explicit handling so it never splits an emoji or combining character mid-sequence.

### Deleting
- `ForumPostViewSet.perform_destroy()` sets `is_deleted=True` - a soft delete, not a database row removal.
- It explicitly refuses to delete a thread's opening post: `"Cannot delete the opening post. Delete the thread instead."` Replies are not subject to this restriction.
- This soft-delete behavior and the opening-post restriction are specific to the website's API. Deleting a post directly in the Django admin portal is a hard delete (permanent, with neither safeguard).
- **Django admin:** deleting a `User` does not cascade-delete their posts; their threads/replies remain, attributed to "Deleted user."
- **Django admin:** the "Parent post" field on a reply only lists posts that open a thread - a reply can't accidentally be set as the parent of another reply.

### Forum-rules gate
- `HasAcceptedForumRules` (permission class) blocks posting, replying, and pinning for non-admin users until `forum_rules_accepted_at` is set.
- Set via `POST /api/forum/accept-rules/`. Admins are exempt.

### Read-only mode
- Driven by `getProgramStatus` / the `is_active` flag, tied to cohort start/end dates.
- If no cohort has ever been configured, the forum stays open (fails open, not closed).

---

## 
