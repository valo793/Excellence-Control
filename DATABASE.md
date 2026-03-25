# Database Guide

## Engine and schema

- Engine: Oracle Database
- Main schema referenced by API: `EC_APP`

## Core entities

### Users and access

- `EC_APP.APP_USERS`
  - identity and profile
  - password hash and reset fields
  - verification flags/timestamps (`IS_VERIFIED`, optional `EMAIL_VERIFIED`, optional `VERIFIED_AT`)
- `EC_APP.ROLES`
  - role catalog (`ADMIN`, `VIEWER`, etc.)
- `EC_APP.USER_ROLES`
  - many-to-many link between users and roles

### Email verification

- `EC_APP.EMAIL_VERIFICATION_TOKENS`
  - `USER_ID` (FK to `APP_USERS.ID`)
  - `TOKEN_HASH` (SHA-256 hash, never raw token)
  - `EXPIRES_AT`
  - `USED_AT`
  - `INVALIDATED_AT`
  - `METADATA_JSON`
  - `CREATED_AT`

Indexes/constraints expected by migration:
- `UQ_EVT_TOKEN_HASH` (unique token hash)
- `IX_EVT_USER_CREATED` (user + created_at)
- `IX_EVT_USER_ACTIVE` (user + active state fields)
- `CK_EVT_TOKEN_HASH_LEN` (`LENGTH(TOKEN_HASH) = 64`)

### Session and remember-me

- `EC_APP.AUTH_REFRESH_TOKENS`
  - `USER_ID` (FK to `APP_USERS.ID`)
  - `TOKEN_HASH` (SHA-256 hash, never raw token)
  - `EXPIRES_AT`
  - `USER_AGENT`
  - `IP_ADDRESS`
  - `CREATED_AT`
  - `LAST_USED_AT`
  - `REVOKED_AT`
  - `REVOKE_REASON`

### Audit trail

- `EC_APP.CHANGE_LOG`
  - `ID`
  - `TABLE_NAME` (users are logged with `APP_USERS`)
  - `RECORD_ID` (target user id)
  - `ACTION` (`C`, `U`, `D`; rollback entries are persisted as `U`)
  - `CHANGED_AT`
  - `ACTOR_ID`
  - `ACTOR_IDENT`
  - `OLD_ROW_JSON`
  - `NEW_ROW_JSON`

### Projects domain

- `EC_APP.PROJECTS`
  - core project fields (title, description, status, priority, owners, category, dates, gains, metadata)
- `EC_APP.EC_PROJECT_MEMBERS`
  - project member list and roles
- `EC_APP.PROJECT_FILES`
  - uploaded file metadata per project
- `EC_APP.PROJECT_SUBTASKS`
  - subtask structure for progress
- `EC_APP.PROJECT_EARNINGS`
  - gains by period
  - expected columns in current environments:
    - `ID`
    - `PROJECT_ID` (FK to `PROJECTS.ID`)
    - `ANO` (year)
    - `MES` (month 1-12)
    - `VALOR` (monthly realized gain amount)
  - app behavior:
    - monthly rows are the source of truth for realized gains timeline
    - `PROJECTS.GANHO_REALIZADO` is synchronized as a derived total
- `EC_APP.PROJECT_ACL`
  - optional project-level access control records

### Async project import jobs

- `EC_APP.PROJECT_IMPORT_JOBS`
  - `ID` (job id, UUID string)
  - `STATUS` (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`)
  - `ACTOR_EMAIL`
  - `ACTOR_ID`
  - `CANCEL_REQUESTED` (`Y`/`N`)
  - `PAYLOAD_JSON` (rows + import metadata; cleared after terminal state)
  - `PROGRESS_JSON` (phase, counters, percentage)
  - `RESULT_JSON` (final summary/logs on completion/cancel)
  - `ERROR_JSON` (error payload on failures)
  - `CREATED_AT`
  - `UPDATED_AT`
  - `STARTED_AT`
  - `FINISHED_AT`

Recommended indexes:
- `PK/UQ` on `ID`
- `IX` on (`STATUS`, `CREATED_AT`) for startup recovery scans
- `IX` on (`STATUS`, `FINISHED_AT`) for retention cleanup

## Relationship summary

```text
APP_USERS 1---* USER_ROLES *---1 ROLES
APP_USERS 1---* EMAIL_VERIFICATION_TOKENS
APP_USERS 1---* AUTH_REFRESH_TOKENS
APP_USERS 1---* CHANGE_LOG (via RECORD_ID)

PROJECTS 1---* EC_PROJECT_MEMBERS
PROJECTS 1---* PROJECT_FILES
PROJECTS 1---* PROJECT_SUBTASKS
PROJECTS 1---* PROJECT_EARNINGS
PROJECTS 1---* PROJECT_ACL
```

## Migrations

### Email verification migration

File:
- `Server/sql/2026-02-21_email_verification.sql`

What it does:
1. Adds verification columns to `APP_USERS` (if missing).
2. Adds verification check constraint.
3. Backfills verification state from legacy `IS_VERIFIED`.
4. Creates `EMAIL_VERIFICATION_TOKENS` (if missing).
5. Ensures compatibility columns/constraints/indexes.

Idempotency:
- Script includes dictionary checks and can be rerun safely.

### Refresh tokens migration

File:
- `Server/sql/2026-02-21_refresh_tokens.sql`

What it does:
1. Creates `AUTH_REFRESH_TOKENS` (if missing).
2. Ensures compatibility columns and token-hash constraint.
3. Ensures unique/indexed access for token hash and active user sessions.

## Data integrity and safety notes

- Store only hashed verification tokens.
- Invalidate stale/older verification tokens after new issuance.
- Keep foreign keys from child tables to `PROJECTS`.
- When deleting projects, remove child records first if DB cascade is not guaranteed.

## Operational checks

- Validate table/column availability before enabling features in API.
- Monitor index usage for:
  - project listing and dashboard filters
  - verification token lookups by hash/user
- Keep DB and app clocks aligned for expiration logic.
