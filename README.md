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

| Variable              | Value                                                                          |
| --------------------- | ------------------------------------------------------------------------------ |
| `VAPID_PRIVATE_KEY`   | Raw base64url private key — the string printed by the extraction command above |
| `VAPID_PUBLIC_KEY`    | The `Application Server Key` printed by `vapid --gen`                          |
| `VAPID_ADMIN_EMAIL`   | Your admin email (included in the VAPID `sub` claim)                           |
| `EMAIL_BACKEND`       | `django.core.mail.backends.smtp.EmailBackend` in production                    |
| `EMAIL_HOST`          | SMTP host                                                                      |
| `EMAIL_PORT`          | `587`                                                                          |
| `EMAIL_HOST_USER`     | SMTP username                                                                  |
| `EMAIL_HOST_PASSWORD` | SMTP password                                                                  |
| `DEFAULT_FROM_EMAIL`  | Sender address shown to students                                               |

In development `EMAIL_BACKEND` defaults to the console backend (emails are printed to
stdout, no SMTP needed) and `VAPID_*` default to empty strings (push is skipped with
a warning).

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
**Admin → Surveys → New Survey**, which copies an existing survey's questions.

### 4. Add the cron jobs

Two commands need to run on a schedule. Both are idempotent: a notification that
was sent successfully is never sent again, and failed sends are retried on the
next run.

- `send_due_reminders` must run **every hour** — it filters each user by their
  `reminder_time` preference (Perth timezone) so a user who chose 5 pm receives their
  reminder at the cron run that corresponds to 5 pm Perth time.
- `send_module_unlock_notifications` tells each participant "Week N is now
  available" on the day that week unlocks for their cohort (cohort start date +
  (N − 1) weeks, Perth time). It only looks at weeks unlocking *today*, so it runs
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

## Taking minutes

I have created a template in the `/minutes` folder to use each meeting. Each meeting, copy the template from the file into a new [HedgeDoc](https://hedgedoc.ucc.asn.au/) by pressing the blue "New guest note" button in the top right (you don't need to sign in).

Make sure to record who was at the meeting, what each person has done since the last meeting, and what each person will do next meeting. it can also be helpful to note down any discussion or decisions made during the meeting.
