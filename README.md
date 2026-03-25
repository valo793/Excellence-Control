# Excellence Control

Excellence Control is a SaaS-style project and portfolio management platform with:
- Kanban board, timeline (Gantt), table and analytics views
- Oracle-backed API with JWT authentication
- Role-based admin features (users management and project deletion)
- Spreadsheet import/export and attachment uploads
- Dark/light theme and EN/PT-BR UI support

## Repository structure

```text
excelence-control/
  src/            # React frontend (Vite)
  Server/         # Express + Oracle backend
  public/         # Static assets (favicon/logo/etc)
  README.md
  ARCHITECTURE.md
  BACKEND.md
  FRONTEND.md
  DATABASE.md
```

## Quick setup

### 1) Frontend

```bash
npm install
```

Create `.env.local`:

```env
VITE_API_URL=http://localhost:3001
VITE_UI_FOUNDATION_V1=false
```

- Set `VITE_UI_FOUNDATION_V1=true` to enable the new Phase 1 design foundation tokens/primitives.

Run:

```bash
npm run dev
```

### 2) Backend

```bash
cd Server
npm install
```

Create `Server/.env` (placeholders only):

```env
PORT=3001
ORA_USER=<oracle_schema_user>
ORA_PASSWORD=<oracle_schema_password>
ORA_CONNECT=//localhost:1521/xepdb1

JWT_SECRET=<strong_random_secret>
JWT_EXPIRES_SHORT=1h
JWT_EXPIRES_LONG=30d

APP_WEB_URL=http://localhost:5173
VERIFY_TOKEN_TTL_HOURS=24
VERIFY_RESEND_COOLDOWN_SECONDS=60

SMTP_HOST=<smtp_host>
SMTP_PORT=587
SMTP_USER=<smtp_user>
SMTP_PASS=<smtp_password>
SMTP_FROM=<noreply@your-domain.com>
```

Run API:

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Documentation index

- `ARCHITECTURE.md`: system overview, module boundaries, data flow, design decisions
- `BACKEND.md`: API stack, structure, auth, endpoints, env and operational notes
- `FRONTEND.md`: UI architecture, views/components, state, theme and UX patterns
- `DATABASE.md`: Oracle data model, key tables/relationships and migrations
- `docs/KANBAN_STRUCTURE_MOCK_V1.md`: low-fidelity Kanban hierarchy mock used as validation gate before structural board refactor
- `docs/screenshots/kanban-legacy-vs-foundation.svg`: comparative legacy vs foundation-enabled Kanban snapshot artifact
- `docs/VISUAL_COHESION_PASS_V1.md`: holistic visual direction statement and workspace cohesion intent
- `docs/SPACING_AUDIT_WORKSPACE_V1.md`: strict spacing-scale audit confirmation for workspace shell + Kanban scope
- `docs/screenshots/workspace-final-intended-state.svg`: refined final-state workspace mock (single target vision)

## Troubleshooting

- `401/Invalid token` in frontend:
  - clear `ec_token` from browser storage and login again
  - verify `JWT_SECRET` is stable on backend
- Frontend cannot call API:
  - check `VITE_API_URL` in `.env.local`
  - confirm API is running on the expected `PORT`
- Oracle connection errors:
  - validate `ORA_USER`, `ORA_PASSWORD`, `ORA_CONNECT`
  - ensure Oracle client/network connectivity to the DB service
- Verification e-mail not sent:
  - SMTP variables are missing or invalid
  - backend falls back to console log mode when SMTP is not configured
- Login blocked by e-mail verification:
  - run migration `Server/sql/2026-02-21_email_verification.sql`
  - confirm `EMAIL_VERIFICATION_TOKENS` exists

## Contributing

1. Create a feature branch.
2. Keep changes scoped and backward compatible.
3. Run frontend build and basic manual API smoke checks.
4. Update docs when adding endpoints, tables or UI flows.
5. Open a PR with:
   - context/problem
   - implementation notes
   - risks and test evidence

## Security notes

- Never commit real secrets in `.env` files.
- Use placeholders in docs and examples.
- Keep `JWT_SECRET` and SMTP credentials in secure secret storage in production.
