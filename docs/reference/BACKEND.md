# Backend Guide

## Stack

- Node.js (ESM modules)
- Express
- Oracle Database driver (`oracledb`)
- JWT (`jsonwebtoken`)
- Validation (`zod`)
- Password hashing (`bcryptjs`)
- File upload (`multer`)
- E-mail (`nodemailer`)

## Folder structure

```text
Server/
  index.js                  # API bootstrap and domain routes
  auth.js                   # Auth, verification, role middleware
  change-log.js             # Audit log helpers and user snapshot/revert helpers
  mailer.js                 # SMTP adapter
  migrate-firebase.mjs      # Firestore -> Oracle migration utility
  sql/
    2026-02-21_email_verification.sql
  uploads/
    projects/<projectId>/   # Uploaded files
```

## Environment variables

Use placeholders only:

```env
PORT=3001

ORA_USER=<oracle_schema_user>
ORA_PASSWORD=<oracle_schema_password>
ORA_CONNECT=//localhost:1521/xepdb1

JWT_SECRET=<strong_random_secret>
JWT_EXPIRES_SHORT=1h
JWT_EXPIRES_LONG=30d

APP_WEB_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173
VERIFY_TOKEN_TTL_HOURS=24
VERIFY_RESEND_COOLDOWN_SECONDS=60
REFRESH_TOKEN_TTL_DAYS=30
REFRESH_COOKIE_NAME=ec_refresh
REFRESH_COOKIE_PATH=/api/auth
REFRESH_COOKIE_SAMESITE=Lax
REFRESH_COOKIE_SECURE=false
AUTH_RATE_LIMIT_ENABLED=true
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=120
AUTH_RATE_LIMIT_STRICT_MAX=20
API_JSON_LIMIT=5mb
PROJECT_IMPORT_MAX_ROWS=1000
PROJECT_IMPORT_JOB_MAX_ROWS=5000
PROJECT_IMPORT_JOB_RETENTION_MINUTES=120

SMTP_HOST=<smtp_host>
SMTP_PORT=587
SMTP_USER=<smtp_user>
SMTP_PASS=<smtp_password>
SMTP_FROM=<noreply@your-domain.com>
```

### Production frontend on IIS

For the IIS frontend deployment model used by this project:

```env
NODE_ENV=production
APP_WEB_URL=https://frontend.your-corporate-domain
CORS_ORIGIN=https://frontend.your-corporate-domain
REFRESH_COOKIE_SECURE=true
REFRESH_COOKIE_SAMESITE=Lax
```

Notes:
- This assumes a corporate same-site HTTPS deployment pattern.
- If the API is later published on a completely different site/domain, review refresh cookie policy before go-live.

## API endpoints

### Health
- `GET /api/db/ping`

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/verify-email?token=...`
- `POST /api/auth/resend-verification`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/me`

### Projects
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id/earnings` (monthly earnings list by project; optional `year`)
- `POST /api/projects/:id/earnings` (upsert one monthly earning entry)
- `PUT /api/projects/:id/earnings` (replace full monthly earnings series for one project)
- `DELETE /api/projects/:id/earnings/:year/:month` (delete one monthly earning entry)
- `POST /api/projects/import` (bulk import with `dryRun=true|false`)
- `POST /api/projects/import/jobs` (async import job creation)
- `GET /api/projects/import/jobs/:jobId` (job status/result)
- `DELETE /api/projects/import/jobs/:jobId` (cancel queued/running async job)
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id` (ADMIN only)

Notes:
- `GET /api/projects` now returns `ganhoRealizado` preferring the monthly sum from `PROJECT_EARNINGS` when available.
- Monthly earnings write routes (`POST/PUT/DELETE /api/projects/:id/earnings...`) synchronize `PROJECTS.GANHO_REALIZADO` automatically as a derived total.

### Async import jobs (projects)

- Async imports are persisted in `EC_APP.PROJECT_IMPORT_JOBS` (not only in memory).
- Job lifecycle: `queued` -> `running` -> `completed | failed | canceled`.
- Ownership is enforced by `ACTOR_EMAIL`:
  - only the creator can read/cancel its own job.
- Cancellation behavior:
  - `queued`: canceled immediately.
  - `running`: marks `cancelRequested`, worker aborts and rolls back pending writes before commit.
- Restart recovery:
  - on API startup, jobs in DB with status `QUEUED` or `RUNNING` are recovered.
  - recovered jobs are re-queued from the start (safe replay), not resumed from middle-row offset.
- Payload cleanup:
  - after terminal status (`completed`, `failed`, `canceled`), `PAYLOAD_JSON` is cleared in DB.
- Retention:
  - terminal jobs are pruned from memory and DB based on `PROJECT_IMPORT_JOB_RETENTION_MINUTES`.
- Env defaults when missing:
  - `PROJECT_IMPORT_MAX_ROWS=1000`
  - `PROJECT_IMPORT_JOB_MAX_ROWS=5000`
  - `PROJECT_IMPORT_JOB_RETENTION_MINUTES=120`

### Project files
- `POST /api/projects/:id/files`
- `GET /api/projects/:id/files`
- `DELETE /api/projects/:projectId/files/:fileId`

### Admin
- `GET /api/admin/users` (ADMIN only)
- `PUT /api/admin/users/:id` (ADMIN only)
- `GET /api/admin/audit/users` (ADMIN only)
- `GET /api/admin/audit/users/:id` (ADMIN only)
- `POST /api/admin/audit/users/:id/revert` (ADMIN only)

### Dashboard
- `GET /api/dashboard/kpis`
- `GET /api/dashboard/charts`
- `GET /api/dashboard/costs`
- `GET /api/dashboard/costs/projects`
- Query params suportados (opcional, mesmos filtros globais da UI):
  - `search`
  - `dateFrom` (`YYYY-MM-DD`)
  - `dateTo` (`YYYY-MM-DD`)
  - `statuses` (csv, ex.: `TODO,IN_PROGRESS,DONE`)
  - `committeeImpacts` (csv)
  - `kaizenCategories` (csv)
  - `priorities` (csv, ex.: `LOW,MEDIUM,HIGH`)
  - `unscheduled` (`true|false|1|0`)

## Auth and authorization

- JWT middleware validates bearer token and injects `req.user`.
- Role checks are DB-backed through `requireRole(pool, roleName)`.
- Admin-protected routes use `requireAdmin` (`ADMIN` role).
- `rememberMe` changes token expiration window:
  - short token: `JWT_EXPIRES_SHORT`
  - long token: `JWT_EXPIRES_LONG`
- when `rememberMe=true`, backend also issues refresh cookie/session:
  - secure cookie (`HttpOnly`, `SameSite`, optional `Secure`)
  - refresh token hash stored per-device in DB
  - multiple concurrent devices supported
- auth endpoints use rate limiting with configurable window/max thresholds.

## E-mail verification flow

1. Register creates user as not verified.
2. Secure random token is generated and only token hash is stored.
3. Verify link is sent by e-mail (`/verify-email?token=...`).
4. Verify endpoint checks token state:
   - exists
   - not expired
   - not used/invalidated
5. User is marked verified and verification timestamp is saved.
6. Token is marked used and sibling active tokens are invalidated.
7. Resend endpoint is neutral and cooldown-protected.

## File handling

- Uploaded files are stored under `Server/uploads/projects/<id>/`.
- Metadata is stored in `EC_APP.PROJECT_FILES`.
- Delete flow removes DB record and attempts file deletion on disk.
- IIS is not used to serve uploads in this phase; uploads remain served by the API under `/uploads/...`.

## Audit logging and rollback

- User changes are recorded in `EC_APP.CHANGE_LOG` for:
  - create (`C`) during register
  - update (`U`) on admin user edits
  - delete/soft-delete (`D`) when user status transitions to `ARCHIVED`
- Logged snapshots come from sanitized user snapshots (no password/hash/token fields).
- Admin audit endpoints support:
  - paginated/filterable audit listing
  - full record detail with old/new JSON
  - secure rollback of selected entries
- Rollback operations write a new audit entry as an update event.

## Jobs/scripts

- Legacy migration utility (one-time):
  - file: `Server/migrate-firebase.mjs`
  - no npm script is maintained for this path
- SQL migration:
  - `Server/sql/2026-02-21_email_verification.sql`
  - adds verification columns/table/indexes

## Troubleshooting

- Oracle errors (`ORA-*`):
  - validate Oracle env vars and connectivity
  - check schema/table permissions for `EC_APP`
- JWT invalid after restart:
  - keep `JWT_SECRET` stable between restarts
- No e-mail delivery:
  - verify SMTP credentials and `SMTP_FROM`
  - check fallback logs when SMTP is missing
- Verification link failing:
  - verify migration script was applied
  - check token TTL and server clock
