# CITS3200-Professional-Computing

## Push Notification Setup

### 1. Generate a VAPID keypair (one-time)

```bash
pip install pywebpush        # installs vapid CLI as a side effect
cd /etc/mindfulness          # or any secure directory
vapid --gen --applicationServerKey
```

This writes `private_key.pem` and `public_key.pem` to the current directory and
prints a line like:

```
Application Server Key = BGFQk5VLb08…
```

That printed value is your `VAPID_PUBLIC_KEY`.

### 2. Set environment variables

| Variable | Value |
|---|---|
| `VAPID_PRIVATE_KEY` | Absolute path to the generated `private_key.pem` (e.g. `/etc/mindfulness/private_key.pem`) |
| `VAPID_PUBLIC_KEY` | The `Application Server Key` string printed by `vapid --gen` |
| `VAPID_ADMIN_EMAIL` | Your admin email (included in the VAPID `sub` claim) |
| `EMAIL_BACKEND` | `django.core.mail.backends.smtp.EmailBackend` in production |
| `EMAIL_HOST` | SMTP host |
| `EMAIL_PORT` | `587` |
| `EMAIL_HOST_USER` | SMTP username |
| `EMAIL_HOST_PASSWORD` | SMTP password |
| `DEFAULT_FROM_EMAIL` | Sender address shown to students |

In development `EMAIL_BACKEND` defaults to the console backend (emails are printed to
stdout, no SMTP needed) and `VAPID_*` default to empty strings (push is skipped with
a warning).

### 3. Run migrations

```bash
python manage.py migrate
```

### 4. Add the cron job

The reminder command must run **every hour** — it filters each user by their
`reminder_time` preference (Perth timezone) so a user who chose 8 am receives their
reminder at the cron run that corresponds to 8 am Perth time.

```cron
# Run every hour; the command filters by each user's preferred reminder hour.
# Server is UTC; Australia/Perth is UTC+8 with no DST.
0 * * * * /path/to/venv/bin/python /path/to/manage.py send_due_reminders >> /var/log/mindfulness/reminders.log 2>&1
```

### 5. Content setup workflow

1. Create modules and content items while `is_published = False`.  
   Editing `day_offset` on unpublished items does not notify anyone.
2. Run the schedule check to confirm every audio item has a `day_offset` before
   students are enrolled:
   ```bash
   python manage.py send_due_reminders --verify
   ```
   This exits non-zero and prints any gaps (unscheduled items, missing days,
   duplicate offsets). Fix all issues before going live.
3. Publish the module. Students in currently active cohorts receive a single S21
   content-update notification. Students in cohorts that have not started yet are
   excluded.

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
