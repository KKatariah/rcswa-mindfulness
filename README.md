# RCSWA Wellbeing - Online Mindfulness Training Program

A web app that delivers the RCSWA mindfulness training program to medical students. Each week unlocks a module of short video lectures (YouTube) and guided meditations (SoundCloud). Students tick off what they've completed, answer a weekly reflection survey, get daily meditation reminders as push notifications, and talk to each other in a moderated forum. Admins manage cohorts, approve sign-ups, edit content and surveys, export survey responses as CSV and moderate the forum.

Built by CITS3200 Group 45 (UWA, Semester 2 2026) for Sarah Moore (RCSWA).

This README is the technical handover: how the project is laid out, how to run it, how to deploy it and how to keep it running. Day-to-day use of the site by admins is covered in the separate non-technical handover document.

## Contents

1. [Tech stack](#1-tech-stack)
2. [Repository layout](#2-repository-layout)
3. [Running it locally](#3-running-it-locally)
4. [Environment variables](#4-environment-variables)
5. [Loading the program content](#5-loading-the-program-content)
6. [How the program runs](#6-how-the-program-runs)
7. [Push notification setup](#7-push-notification-setup)
8. [Deploying to production](#8-deploying-to-production)
9. [Testing and CI](#9-testing-and-ci)
10. [Feature reference](#10-feature-reference)
11. [Troubleshooting](#11-troubleshooting)
12. [Known limitations and open items](#12-known-limitations-and-open-items)
13. [Other project documents](#13-other-project-documents)

---

## 1. Tech stack

| Part          | Technology                                                                    |
| ------------- | ----------------------------------------------------------------------------- |
| Frontend      | Next.js 16 (Pages Router), React 19, TypeScript, Tailwind CSS 4               |
| Backend       | Django 6, Django REST Framework, Python 3.12+                                 |
| Database      | SQLite (one file; path set by `DJANGO_DB_PATH`)                               |
| Sign-in       | Email + password, or Google sign-in (`@react-oauth/google` + `google-auth`)   |
| Notifications | Web Push (VAPID, `pywebpush`) with a service worker (`client/public/sw.js`)   |
| Static files  | WhiteNoise serves the Django admin's CSS/JS in production                     |
| Tests         | Django test runner (backend), Vitest (frontend unit), Playwright (end-to-end) |
| Monitoring    | Optional Sentry error reporting; `GET /api/health/` for uptime checks         |

All times are Perth time (`TIME_ZONE = 'Australia/Perth'`, UTC+8, no daylight saving).

---

## 2. Repository layout

```text
.
├── manage.py               Django entry point (run all manage.py commands from the repo root)
├── requirements.txt        Python dependencies
├── server/                 Django project: settings.py, urls.py, wsgi.py, asgi.py
├── app/                    The Django app with all backend logic
│   ├── models.py           Database models (User, Cohort, Enrollment, Module, ContentItem,
│   │                       Survey, SurveyResponse, ForumThread, ForumPost, NotificationLog, ...)
│   ├── views.py            API views and viewsets
│   ├── api_urls.py         Non-router API routes (login, register, health, profile, ...)
│   ├── serializers/        DRF serializers, one file per area (content, surveys, forum, ...)
│   ├── access.py           Shared rules: who is an admin, when a module/survey unlocks
│   ├── permissions.py      API permission classes (IsApproved is the default)
│   ├── authentication.py   Per-device login tokens that expire after 7 days unused
│   ├── lockout.py          Locks an account for 5 minutes after 5 wrong passwords
│   ├── notifications.py    Web push sending
│   ├── signals.py          Auto-creates weekly surveys, sends content-update notifications
│   ├── survey_template.py  Standard weekly survey questions (MAQ q1–q12 + reflection q13)
│   ├── exports.py          Survey response CSV export
│   ├── moderation.py       Forum reports, removals and bans
│   ├── admin.py            Django admin (/admin/) customisations
│   ├── content/            rcswa_modules.json — the program's module content
│   ├── fixtures/           dev_seed.json, weekly_survey.json (development data)
│   ├── management/commands/  Cron jobs, content import and dev seeding commands
│   ├── migrations/         Database migrations (some also seed default data)
│   └── tests/              Backend tests
├── client/                 Next.js frontend
│   ├── src/pages/          One file per page; src/pages/admin/ is the admin portal
│   ├── src/components/     UI components (main/, admin/, modules/, surveys/, notifications/, ui/)
│   ├── src/lib/            API client (api.ts) and shared logic, with its unit tests
│   ├── src/context/        AuthContext (signed-in user and token)
│   ├── public/             Static assets, PWA manifest, icons and the push service worker (sw.js)
│   ├── e2e/                Playwright end-to-end tests and their seed script
│   └── scripts/            generate-icons.mjs (rebuilds PWA icons from a logo)
├── documentation/          Non-technical handover and Notifications Maintenance Guide (.docx / .pdf)
├── Dockerfile              API image (also runs the scheduled commands); client/Dockerfile is the frontend's
├── docker-compose.yml      Production stack; docker-compose.build.yml builds from this checkout instead
├── deploy/                 Container entrypoint and crontab
├── .env.example            Every variable the Docker setup reads
├── DEPLOYMENT.md           Docker deployment, updates, rollback and backups
└── .github/workflows/      CI checks, Docker image publishing, and issue/branch automation
```

Do not put anything except pages in `client/src/pages/`. Next.js treats every file in that folder as a page, so a test file there breaks the production build. Put tests next to the code they test in `src/lib/`, `src/hooks/` or `src/components/` instead.

---

## 3. Running it locally

### Prerequisites

- Python **3.12 or newer** (Django 6 needs it; CI uses 3.12)
- Node.js **20 or newer** with npm (CI uses Node 20)
- Git

### Backend (terminal 1)

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser     # first time only: asks for email, full name, password
python manage.py runserver           # http://127.0.0.1:8000
```

Use `.venv` at the repo root as the name: the Playwright end-to-end tests look for `.venv/bin/python` there. Use `python -m pip` rather than plain `pip` so packages always go into the same Python that runs Django (see [Troubleshooting](#11-troubleshooting)).

The account from `createsuperuser` is an app admin: it can open the admin portal (`/admin` on the frontend) and the Django admin (`http://127.0.0.1:8000/admin/`).

### Frontend (terminal 2)

```bash
cd client
npm install
npm run dev                          # http://localhost:3000
```

Open <http://localhost:3000>. Keep both terminals running.

With no frontend env file, the frontend talks to the API at `http://127.0.0.1:8000/api` and the Google sign-in button is hidden. To turn Google sign-in on locally, see [Environment variables](#4-environment-variables).

### Data for development

A fresh database has no modules. Pick one of these:

- **Real program content (recommended):** `python manage.py import_rcswa_modules`. See [Loading the program content](#5-loading-the-program-content).
- **Small placeholder data set:** on an **empty** database only, `python manage.py loaddata dev_seed weekly_survey`. This adds two placeholder modules, their weekly surveys (`weekly-maq-w1`, `weekly-maq-w2`) and a student `student@dev.local`; set its password with `python manage.py changepassword student@dev.local`. Never load `dev_seed` into a database with data in it: it uses fixed IDs and overwrites user 1, modules 1–2 and content items 1–4.

To try **Admin → Moderation**, `python manage.py seed_moderation` adds demo students (`@moderation-demo.test`) with reported posts, removed posts and forum bans. Re-running it resets that data; `--clear` deletes it. Never run it in production.

Students can only use the site once they have an **active enrollment** (see [How the program runs](#6-how-the-program-runs)). To test as a student, create a cohort in **Admin → Cohorts**, sign up as a new user, then approve them in **Admin → Approvals**.

### After pulling new changes

Teammates' changes may add packages or migrations:

```bash
python -m pip install -r requirements.txt
python manage.py migrate
cd client && npm install
```

---

## 4. Environment variables

### Backend

Set these in a `.env` file at the repo root (loaded by `python-dotenv`) or in the server's environment. `.env` is git-ignored: never commit secrets. Everything has a development default, so nothing is required locally.

| Variable                 | Default                                       | Purpose                                                                         |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------- |
| `DJANGO_DEBUG`           | `True`                                        | Set `False` in production                                                       |
| `DJANGO_SECRET_KEY`      | `django-insecure-dev-only` while debug is on  | Required when `DJANGO_DEBUG=False`: the API refuses to start without it         |
| `ALLOWED_HOSTS`          | `localhost,127.0.0.1,[::1]`                   | Comma-separated hostnames the API answers to                                    |
| `CORS_ALLOWED_ORIGINS`   | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated frontend origins, with protocol                                 |
| `CSRF_TRUSTED_ORIGINS`   | _(empty)_                                     | Comma-separated HTTPS origins, needed for the Django admin behind HTTPS         |
| `DJANGO_DB_PATH`         | `db.sqlite3` in the repo root                 | SQLite database file. In production, put it on persistent storage               |
| `MEDIA_ROOT`             | `media/` in the repo root                     | Uploaded resource cover images. Must survive redeploys                          |
| `SERVE_MEDIA`            | `True`                                        | `False` if a reverse proxy serves `/media/` instead of Django                   |
| `GOOGLE_CLIENT_ID`       | _(unset)_                                     | Google OAuth client ID; the API checks Google sign-in tokens against it         |
| `VAPID_PRIVATE_KEY`      | _(empty: push skipped with a warning)_        | Web push private key, see [Push notification setup](#7-push-notification-setup) |
| `VAPID_PUBLIC_KEY`       | _(empty)_                                     | Web push public key                                                             |
| `VAPID_ADMIN_EMAIL`      | `admin@mindfulness.example.com`               | Contact email sent to push services. Set a real address                         |
| `LOG_LEVEL`              | `INFO`                                        | `WARNING` for quieter logs                                                      |
| `SENTRY_DSN`             | _(unset)_                                     | Optional. Reports unhandled errors (web requests and cron commands) to Sentry   |
| `SENTRY_ENVIRONMENT`     | `production`                                  | Optional label shown in Sentry, e.g. `staging`                                  |
| `AUTH_THROTTLE_RATE`     | `10/min`                                      | Logins per IP. Only the e2e tests raise it                                      |
| `REGISTER_THROTTLE_RATE` | `5/5m`                                        | Sign-ups per IP                                                                 |

Setting `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` or `CSRF_TRUSTED_ORIGINS` **replaces** its default, so include `localhost` too if you still need it.

Generate a production `DJANGO_SECRET_KEY` with `python -c "import secrets; print(secrets.token_urlsafe(50))"`. It signs sessions and hashes the login lockout records, so changing it later only resets lockouts and Django admin sessions.

The Docker setup also uses `BEHIND_PROXY` (trust the proxy's `X-Forwarded-*` headers; `docker-compose.yml` sets it) and `SECURE_COOKIES` (`True` once the site is served over HTTPS). Both default to `False`.

`GOOGLE_CLIENT_SECRET` is read by `settings.py` but nothing uses it. Google sign-in only needs the client ID.

### Frontend

Set these in `client/.env.local` (git-ignored) or the build environment.

| Variable                       | Default                     | Purpose                                                                    |
| ------------------------------ | --------------------------- | -------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`     | `http://127.0.0.1:8000/api` | Where the Django API lives, ending in `/api`                               |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | _(unset: button hidden)_    | Same Google OAuth client ID as the backend's `GOOGLE_CLIENT_ID`            |
| `DEV_ALLOWED_ORIGINS`          | _(empty)_                   | Dev only: extra hostnames (no protocol) for hot reload, e.g. a tunnel host |

`NEXT_PUBLIC_*` values are built into the JavaScript bundle, so **rebuild the frontend after changing them**. `NEXT_PUBLIC_API_BASE_URL` also feeds the Content Security Policy in `client/next.config.ts`, so a wrong value blocks API calls in the browser.

### Google sign-in

1. In Google Cloud Console, create an OAuth 2.0 Client ID of type **Web application**.
2. Under **Authorised JavaScript origins**, add every frontend URL that shows the button (e.g. `http://localhost:3000` and the production URL).
3. Put the client ID in both `GOOGLE_CLIENT_ID` (backend) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend).
4. On the Google Cloud Console, in the credentials tab click on the Online Mindfulness Web client 1 link

<img width="213" height="27" alt="image" src="https://github.com/user-attachments/assets/609b56e0-d699-4ea3-8085-e49803a806fe" />

Then change the URLS from the current localhost url to production url

<img width="495" height="318" alt="image" src="https://github.com/user-attachments/assets/54ad5bfa-ec74-4460-8d16-89cc4e386e46" />

A Google sign-in for an email that already has a password account is refused (sign-up doesn't verify emails, so Google must not take over that account). New Google users are enrolled pending approval, like password sign-ups.

---

## 5. Loading the program content

For a new production database, run these in order:

```bash
python manage.py migrate
python manage.py import_rcswa_modules --dry-run   # preview
python manage.py import_rcswa_modules             # import, unpublished
```

- `migrate` also seeds the public Resources page (books, documentaries, online programs) via a data migration.
- `import_rcswa_modules` loads the Week 0 introduction and the eight weekly modules from `app/content/rcswa_modules.json`. It's safe to re-run: it doesn't duplicate modules or media, keeps each module's published/unpublished state and never touches student records. Add `--publish` to publish everything at once; otherwise publish module by module in **Admin → Modules**.
- Each new module (except Week 0) automatically gets a weekly survey with the standard questions from `app/survey_template.py`, coded `weekly-w1` … `weekly-w8`. If any are missing, `python manage.py seed_surveys` adds one per module and skips modules that already have one.

**Don't load the `weekly_survey` fixture on top of imported content.** It's for the `dev_seed` placeholder data only. It writes surveys with IDs 1 and 2 onto modules with IDs 1 and 2, which after an import are the Week 0 introduction and Week 1. The result is a "Week 1" survey attached to the introduction and Week 2's survey replaced.

To change program content later, edit it in **Admin → Modules** rather than the JSON file. Admins can add extra surveys from **Admin → Surveys → New Survey**, which copies an existing survey's questions.

### Content setup workflow

1. Create or import modules and content items while they are unpublished. Editing unpublished items doesn't notify anyone.
2. Give every week an audio item. Each day of a running week, students get one meditation reminder for that week's first audio item. Check nothing is missing before students are enrolled:

   ```bash
   python manage.py send_due_reminders --verify
   ```

   This exits non-zero and lists any published week with no audio item.

3. Publish the module. Students in currently active cohorts who can already open that week receive a single content-update notification. Students in cohorts that haven't started yet, or for whom the week is still locked, are excluded; they hear about it from `send_module_unlock_notifications` when it opens.

---

## 6. How the program runs

- **Roles.** Every user is a `student` or an `admin` (`User.role`). Superusers are always admins, and `is_staff` follows the role automatically. Change a user's role by editing them in **Admin → Users** (or in the Django admin). The rule for who counts as an admin lives in `app/access.py` (`is_admin`).
- **Cohorts.** A cohort is one run of the program with a start and end date. Create the next cohort **before** students sign up: each new sign-up is automatically enrolled, as _pending_, in the current cohort, or the soonest upcoming one if none is running. If no cohort exists, the sign-up gets no enrollment.
- **Approval.** Students can't use the site until an admin approves their enrollment in **Admin → Approvals** (enrollment status `pending` → `active`). Until then the API answers "Your account is awaiting admin approval." Admins never need approval.
- **Unlocking.** Week N opens (N − 1) weeks after the cohort's start date; the Week 0 introduction opens with Week 1. A weekly survey unlocks once all content items in its module are complete. Students may work ahead within unlocked weeks. These rules live in `app/access.py`.
- **Forum.** Read-only once the program is over, based on cohort dates. If no cohort has ever been set up, the forum stays open.
- **Survey data.** Responses are exported as CSV from **Admin → Surveys** (one survey or all of them) or the admin dashboard. Column headers use each question's permanent ID (`q1`, `q2`, …), which doesn't change when questions are reordered. Answers to questions that were edited or deleted after they were answered are flagged in the export.
- **Sign-in security.** Login tokens are per device and expire after 7 days unused. Five wrong passwords in a row lock an account for 5 minutes.

---

## 7. Push notification setup

Reminders and announcements are **push only** (no email or SMS). Push needs HTTPS in production (browsers allow plain HTTP only on `localhost`), and each student turns notifications on from their Profile page. A student with no registered device gets a `status=SKIPPED` log entry, which is retried on the next run like a failure.

The full maintenance guide is in `documentation/Notifications Maintenance Guide.pdf`.

### 7.1 Generate a VAPID keypair (one-time)

With the project's virtual environment active (`pywebpush` is in `requirements.txt` and installs the `vapid` command):

```bash
cd /tmp                      # work in /tmp so PEM files never enter the repo
vapid --gen --applicationServerKey
```

This writes `private_key.pem` and `public_key.pem` to the working directory and prints a line like:

```text
Application Server Key = BGFQk5VLb08…
```

That printed value is your `VAPID_PUBLIC_KEY`. Now extract the raw private key as a portable base64url string; this is what you set as `VAPID_PRIVATE_KEY`:

```bash
python3 -c "
from py_vapid import Vapid; import base64
v = Vapid.from_file('/tmp/private_key.pem')
n = v.private_key.private_numbers().private_value
print(base64.urlsafe_b64encode(n.to_bytes(32,'big')).rstrip(b'=').decode())
"
```

Store the printed string as `VAPID_PRIVATE_KEY` in your environment or secrets manager, then delete the PEM files. `pywebpush` checks `os.path.isfile()` first; a base64url string fails that check and is passed to `Vapid.from_string()` instead, so no file needs to exist on the server at runtime. This survives ephemeral filesystem redeploys.

Keep the same keypair once students have subscribed. Changing it invalidates every existing subscription, and students would have to turn notifications on again.

### 7.2 Set environment variables

| Variable            | Value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| `VAPID_PRIVATE_KEY` | Raw base64url private key: the string printed by the extraction command above |
| `VAPID_PUBLIC_KEY`  | The `Application Server Key` printed by `vapid --gen`                         |
| `VAPID_ADMIN_EMAIL` | Your admin email (included in the VAPID `sub` claim)                          |

In development `VAPID_*` default to empty strings and push is skipped with a warning. The frontend fetches the public key from `GET /api/notifications/vapid-public-key/`, so it needs no separate setting.

### 7.3 Add the cron jobs

Two commands need to run on a schedule. Both are idempotent: a notification that was sent successfully is never sent again, and failed sends are retried on the next run.

- `send_due_reminders` must run **every hour**. It filters each user by their `reminder_time` preference (Perth time), so a user who chose 8 am receives their reminder at the run that corresponds to 8 am Perth time.
- `send_module_unlock_notifications` tells each participant "Week N is now available" on the day that week unlocks for their cohort (cohort start date + (N − 1) weeks, Perth time). It only looks at weeks unlocking _today_, so it runs hourly during the day: the 7 am run sends the notices, and later runs retry failures.

```cron
# Server is UTC; Australia/Perth is UTC+8 with no DST.

# Every hour; the command filters by each user's preferred reminder hour.
0 * * * * /path/to/.venv/bin/python /path/to/manage.py send_due_reminders >> /var/log/mindfulness/reminders.log 2>&1

# Hourly from 7 am to 8 pm Perth (23:00–12:00 UTC).
5 23,0-12 * * * /path/to/.venv/bin/python /path/to/manage.py send_module_unlock_notifications >> /var/log/mindfulness/unlocks.log 2>&1
```

Cron doesn't read the repo's `.env` file into its environment, but `settings.py` loads it itself, so the commands still get the same settings as the web server. If production settings live in the server's environment instead of `.env`, make sure cron has them too.

### 7.4 Operational commands

```bash
# Dry-run reminders to see who would be notified today
python manage.py send_due_reminders --dry-run

# Check schedule completeness for all active cohorts
python manage.py send_due_reminders --verify

# Push adoption report (% of enrolled students with a push subscription)
python manage.py push_adoption
python manage.py push_adoption --csv    # machine-readable
```

---

## 8. Deploying to production

**The recommended deployment is Docker Compose: see [DEPLOYMENT.md](DEPLOYMENT.md).** It runs the API, the frontend, the scheduled notification commands and a proxy from `docker-compose.yml` plus one `.env` file (`.env.example` lists every variable). The cron jobs, `collectstatic` and migrations are all handled by the containers.

The rest of this section is for deploying without Docker. The app is two processes behind one HTTPS domain or two subdomains: the Django API and the Next.js frontend.

### Deploying the backend

```bash
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
gunicorn server.wsgi:application --bind 127.0.0.1:8000 --workers 3
```

Run `migrate` and `collectstatic` on every deploy. `collectstatic` lets WhiteNoise serve the Django admin's CSS and JS when `DJANGO_DEBUG=False`. Run gunicorn under a process manager (systemd, Docker or similar) so it restarts on failure and on reboot.

These variables need production values. The rest keep their defaults from [Environment variables](#4-environment-variables) unless you want to change them (e.g. `LOG_LEVEL`, Sentry, `SERVE_MEDIA`).

| Variable               | Production value                                                             |
| ---------------------- | ---------------------------------------------------------------------------- |
| `DJANGO_DEBUG`         | `False`                                                                      |
| `DJANGO_SECRET_KEY`    | A newly generated secret (required; see [4](#4-environment-variables))       |
| `ALLOWED_HOSTS`        | The API's hostname                                                           |
| `CORS_ALLOWED_ORIGINS` | The frontend's origin, e.g. `https://wellbeing.example.org`                  |
| `CSRF_TRUSTED_ORIGINS` | The API's HTTPS origin, so the Django admin's forms work                     |
| `DJANGO_DB_PATH`       | Database file on persistent storage                                          |
| `MEDIA_ROOT`           | Folder for uploaded cover images on persistent storage                       |
| `GOOGLE_CLIENT_ID`     | The Google OAuth client ID                                                   |
| `VAPID_*`              | The keypair and a real admin email, see [7.2](#72-set-environment-variables) |

- Logs go to the console (stderr); gunicorn, systemd, Docker and cron all capture it. Users appear in logs by ID, never by email. Sentry is sent no emails, IP addresses or request bodies (survey answers).
- `GET /api/health/` returns `200 {"status": "ok"}` when the API can reach its database (`503` otherwise) and needs no login. Point an uptime monitor at it.
- List endpoints that grow over time (`/api/users/`, `/api/enrollments/`, `/api/forum/threads/`) are paged: `?limit=&offset=` (25 by default, at most 100), and respond with `{count, next, previous, results}`.

### Deploying the frontend

```bash
cd client
npm ci
NEXT_PUBLIC_API_BASE_URL=https://api.example.org/api \
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client id> \
npm run build
npm run start            # serves on port 3000; use -- -p <port> to change it
```

Set the `NEXT_PUBLIC_*` values **at build time**; changing them later needs a rebuild.

### Reverse proxy, HTTPS and cron

- Put both processes behind a reverse proxy (e.g. nginx) with HTTPS. Push notifications, the service worker and Google sign-in all need HTTPS.
- Add the frontend's production URL to the Google OAuth client's authorised JavaScript origins.
- Install the two cron jobs from [Add the cron jobs](#73-add-the-cron-jobs).

### Backups

All program data (users, progress, survey responses, forum) is in the one SQLite file, and uploaded cover images are in `MEDIA_ROOT`. Back both up regularly, e.g. with a daily crontab entry:

```cron
# Daily at 2 am Perth (18:00 UTC). Cron needs % escaped as \%.
0 18 * * * sqlite3 /path/to/db.sqlite3 ".backup '/backups/db-$(date +\%F).sqlite3'"
```

Use `.backup` (or stop the app first) rather than copying the file while the app is writing to it.

---

## 9. Testing and CI

### Running tests locally

```bash
# Backend (from the repo root)
python manage.py test
python manage.py makemigrations --check --dry-run   # fails if a model change has no migration
python -m pip install flake8 flake8-django           # linter, not in requirements.txt
flake8 --max-line-length 150 --exclude=migrations app server manage.py

# Frontend (from client/)
npm test                  # Vitest unit tests (src/**/*.test.ts[x])
npm run lint              # ESLint
npx tsc --noEmit          # type check
npm run build             # production build

# End-to-end (from client/), needs .venv at the repo root
npx playwright install    # first time only: downloads the browsers
npm run test:e2e          # desktop Chrome
npm run test:e2e:all      # desktop, Android (Pixel 7) and iOS (iPhone 14) one after another
```

The end-to-end run starts its own API on port 8001 with a fresh `e2e.sqlite3` database and its own frontend on port 3100, so it never touches your normal dev servers or data.

### CI (GitHub Actions)

Every pull request and push to `main` runs:

- **Backend code checks** (`.github/workflows/ci-backend.yml`): flake8, missing-migration check, migrations, the test suite, and `pip-audit` on `requirements.txt`.
- **Frontend code checks** (`.github/workflows/ci-frontend.yml`): ESLint, `tsc`, `next build`, Vitest, and `npm audit` (production dependencies, high severity).

On a push to `main`, `.github/workflows/docker-publish.yml` runs both sets of checks and, if they pass, publishes the Docker images to GHCR (see [DEPLOYMENT.md](DEPLOYMENT.md)).

`main` requires an approving review and passing required checks before merging. Two more workflows automate the team's process: `create-branch.yml` creates a branch for each new issue, and `issue-autolink.yml` links a new pull request to the issue its branch came from.

Keep `requirements.txt` UTF-8. On Windows, PowerShell's `>` writes UTF-16LE, which breaks pip on Linux CI, so regenerate it with:

```powershell
pip freeze | Out-File -Encoding utf8 requirements.txt
```

---

## 10. Feature reference

### User profile

- **Frontend:** `client/src/pages/profile.tsx`
- **API client:** `changePassword` and `updateProfile` in `client/src/lib/api.ts`

#### Avatars: Gravatar

- Avatar URLs are computed server-side in `app/utils.py` (`gravatar_url()`), using a SHA-256 hash of the user's lower-cased email.
- Uses only Gravatar's free, unauthenticated avatar endpoint. No API key is needed; one is only required to fetch other Gravatar profile fields. See Gravatar's [documentation](https://docs.gravatar.com) for its other features.

#### User payload / serialisation

`GET /api/user/`, and the `login`, `register`, `google-login`, `profile`, and `forum/accept-rules` endpoints, all return the hand-built `_user_payload()` dict from `app/views.py`.

### Weekly surveys

- **Student page:** `client/src/pages/surveys/[surveyId].tsx`
- **Admin editor:** `client/src/pages/admin/surveys/[surveyId].tsx`, with logic in `client/src/lib/surveyEditor.ts`
- **Backend:** `Survey`, `SurveyResponse` in `app/models.py`; validation in `app/serializers/surveys.py`

How it works:

- Questions are stored as JSON on `Survey.questions`. Each has a permanent `id` (`q1`, `q2`, …, shown as the blue badge in the editor). Answers, the CSV export and skip rules all refer to this ID, so it stays with the question when questions are reordered; only the "Question N" label changes. The one exception: changing the answer type of a question that already has answers gives it a new ID, so old and new answers don't mix in one CSV column.
- A question can be skipped based on an earlier number or rating-scale question's answer ("skip when q1 is 0"). The question it depends on must come before it. The editor shows a warning panel and disables Save while any skip rule points at a later question, and the API rejects such a save as well.
- Admins can keep editing a survey after students have answered it. Existing answers are kept; answers to a question that was later edited or deleted are flagged in the responses view and the CSV export. Reordering alone doesn't flag anything.

### Forum

- **Frontend:** `client/src/pages/forum.tsx`
- **Models:** `ForumThread`, `ForumPost`, `ForumFlag`, `ForumRulesRevision` in `app/models.py`
- **Admin customisations:** `app/admin.py`; moderation logic in `app/moderation.py`

#### Pinning threads

- `is_pinned` (bool) + `pin_order` (int) on `ForumThread`. The maximum number of pinned threads is `FORUM_MAX_PINNED_THREADS` in `server/settings.py` (currently 5); change it only there.
- `ForumThreadViewSet.partial_update()` (`app/views.py`) wraps the change in `transaction.atomic()`, detects `is_pinned` flipping in the incoming request data, and calls `thread.reorder_pinned_threads(1 if thread.is_pinned else None)`. A newly pinned thread is always inserted at `pin_order` position 1, shifting the rest down.
- **Feed ordering:** `order_by("-is_pinned", "pin_order", "-updated_at")`.
- **Django admin:** the `pin_order` dropdown is limited to the number of currently pinned threads (+1), capped at the maximum. Admin validation blocks saving `pin_order` on a thread without `is_pinned` ticked.

#### Editing

- `edited_at` is a separate field from `created_at`; the original post time is never overwritten.
- `ForumPostViewSet.perform_update()` recomputes the thread title via `_derive_title(post.body)` and writes it onto any `ForumThread` this post opens, so a thread's title stays in sync with its opening post.
  - `_derive_title()` truncates to ≤60 characters at a word boundary, and never splits an emoji or combining character mid-sequence.

#### Deleting

- `ForumPostViewSet.perform_destroy()` sets `is_deleted=True`: a soft delete, not a database row removal.
- It refuses to delete a thread's opening post: `"Cannot delete the opening post. Delete the thread instead."` Replies are not subject to this restriction.
- This soft delete and the opening-post restriction only apply through the website's API. Deleting a post in the Django admin is a hard delete (permanent, with neither safeguard).
- **Django admin:** deleting a `User` does not cascade-delete their posts; their threads and replies remain, attributed to "Deleted user".
- **Django admin:** the "Parent post" field on a reply only lists posts that open a thread, so a reply can't accidentally be set as the parent of another reply.

#### Forum-rules gate

- `HasAcceptedForumRules` (permission class) blocks posting, replying and pinning for non-admin users until they have agreed to the current forum rules.
- Agreement is recorded with `POST /api/forum/accept-rules/`. Admins are exempt. If the rules change in a way that needs re-agreeing (`ForumRulesRevision`), students are asked to agree again.

#### Moderation and read-only mode

- Students can report posts. Admins review reports, remove posts (removed posts stay visible to admins only) and ban users from posting in **Admin → Moderation**. A banned user can still read the forum.
- Read-only mode is driven by `getProgramStatus` / the `is_active` flag, tied to cohort start and end dates. If no cohort has ever been configured, the forum stays open (fails open, not closed).

## 11. Troubleshooting

| Symptom                                                        | Cause and fix                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `No module named 'whitenoise'` (or any package) on `runserver` | Packages were installed into a different Python. Activate `.venv` and run `python -m pip install -r requirements.txt`.                                                                                                                                                         |
| `Could not open requirements file`                             | You're in the wrong folder. `requirements.txt` and `manage.py` are at the repo root, not in `server/`.                                                                                                                                                                         |
| CI build fails with `Property 'default' is missing`            | A non-page file (often a test) is in `client/src/pages/`. Move it to `src/lib/` or next to the component it tests.                                                                                                                                                             |
| Browser shows CORS errors calling the API                      | The frontend's origin isn't in `CORS_ALLOWED_ORIGINS`. Remember that setting it replaces the localhost defaults.                                                                                                                                                               |
| API calls blocked with a Content Security Policy error         | `NEXT_PUBLIC_API_BASE_URL` doesn't match where the API really is. Fix it and rebuild the frontend.                                                                                                                                                                             |
| Google sign-in button missing                                  | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` isn't set (rebuild after setting it).                                                                                                                                                                                                           |
| Google sign-in fails with "Invalid Google token"               | Backend `GOOGLE_CLIENT_ID` is unset or differs from the frontend's, or the site's origin isn't authorised in Google Cloud Console.                                                                                                                                             |
| "Your account is awaiting admin approval"                      | The user has no active enrollment. Approve them in **Admin → Approvals**. If they aren't listed there, no cohort existed when they signed up: create one, then pick it under **Cohort** when editing the user in **Admin → Users** (this enrols them as active straight away). |
| Nobody gets reminders                                          | Check the cron jobs are running and logging, VAPID keys are set, and `python manage.py push_adoption` shows students have subscribed. `send_due_reminders --dry-run` shows who would be notified.                                                                              |
| Django admin has no styling in production                      | Run `python manage.py collectstatic --noinput`.                                                                                                                                                                                                                                |
| Uploaded cover images disappear after a redeploy               | `MEDIA_ROOT` isn't on persistent storage.                                                                                                                                                                                                                                      |
| Save fails in the survey editor                                | A skip rule points at a later question; the warning panel names it. Move the question back below the one it depends on, or change its skip rule.                                                                                                                               |

---

## 12. Known limitations and open items

- **SQLite** suits the expected scale (50–80 students per intake) on a single server. Running several app servers against one database, or much larger numbers, would mean moving to PostgreSQL (change `DATABASES` in `server/settings.py`).
- **Content-update notifications are sent from a daemon thread.** A web server restart while a batch is in flight silently drops the remaining sends, with no retry. This is acceptable at the current scale; if reliability requirements increase, replace the thread with a persistent task queue (e.g. Celery + Redis). Daily reminders are not affected: `send_due_reminders` is cron-driven and only `status=SENT` entries prevent re-delivery, so users left with a `status=FAILED` entry after a restart are retried on the next hourly run.
- **Push notifications depend on the browser.** On iPhone, web push only works after the student adds the site to their Home Screen (iOS 16.4 or later).

---

## 13. Other project documents

- [`DEPLOYMENT.md`](DEPLOYMENT.md): deploying and running the app with Docker Compose.
- `documentation/Notifications Maintenance Guide.pdf` (and `.docx`): maintaining push notifications.
- `documentation/RCSWA_Wellbeing_Non-Technical_Handover.pdf` (and `.docx`): using the site day to day: modules, surveys, notifications, resources, the forum and the admin portal.
