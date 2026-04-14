# Architecture Overview

## Goal

Excellence Control is structured as a split frontend/backend web application:
- Frontend SPA for project operations and analytics
- Backend REST API for auth, data access and file operations
- Oracle schema (`EC_APP`) as the system of record

## High-level diagram

```text
Browser (React + Vite)
  -> REST API (Express)
    -> Oracle DB (EC_APP schema)
    -> File storage (Server/uploads)
    -> SMTP provider (verification/reset e-mail)
```

## Frontend architecture

- Entry point: `src/main.jsx`
- App shell and global orchestration: `src/App.jsx`
- Route-like view state managed in-app (no router dependency)
- View modules:
  - `src/views/Kanban.jsx`
  - `src/views/Roadmap.jsx`
  - `src/views/TableView.jsx`
  - `src/views/Dashboard.jsx`
  - `src/views/AdminUsersView.jsx`
  - Auth/Landing/Verify views
- Reusable components:
  - `src/components/Header.jsx`, `src/components/Sidebar.jsx`
  - `src/components/FiltersPopup.jsx` (global filter UX)
  - `src/components/Gantt.jsx` (timeline renderer based on `frappe-gantt`)
  - modal/forms/import/help/settings components
- API client:
  - `src/config/oracle.js` (fetch wrappers, auth token storage, API calls)
- Design system:
  - `src/ui/visuals.js` + `src/styles/index.css`
  - central classes/tokens for buttons, fields, cards, badges, shell

## Backend architecture

- Runtime: Node.js + Express (`Server/index.js`)
- Auth module: `Server/auth.js`
  - register/login/me
  - e-mail verification and resend flow
  - forgot/reset password
  - JWT middleware and role middleware
- Mailer adapter: `Server/mailer.js`
- Data migration utility: `Server/migrate-firebase.mjs`
- SQL migration scripts: `Server/sql/*.sql`

## Data flow (core scenarios)

### Login/session
1. Frontend calls `POST /api/auth/login` with `rememberMe`.
2. Backend returns JWT with short/long expiry.
3. Frontend stores token in `sessionStorage` (default) or `localStorage` (remember me).
4. Requests use `Authorization: Bearer <token>`.

### Project CRUD
1. Frontend calls projects endpoints from `src/config/oracle.js`.
2. Backend validates JWT and role where needed.
3. Oracle is read/written via pooled connections.
4. Frontend refreshes in-memory project state.

### Roadmap timeline
1. `App.jsx` maps filtered projects into scheduled/unscheduled datasets.
2. `Roadmap.jsx` renders status-filtered Gantt + unscheduled cards.
3. `Gantt.jsx` computes compact temporal window and planned continuation.

### Global filters
1. Header opens `FiltersPopup`.
2. Draft filter state is applied via explicit action.
3. Applied filters are persisted in local storage (`ec_project_filters_v1`).
4. Views consume the same filtered dataset for consistency.

## Core technical decisions

- Single API client (`src/config/oracle.js`) to centralize error handling/token behavior.
- Role authorization in backend with DB-backed roles (`USER_ROLES` + `ROLES`).
- Incremental schema compatibility in auth:
  - checks whether verification columns/tables exist
  - fallback behavior when migration is missing
- Frontend visual consistency via shared style tokens instead of per-component styling drift.

## Non-goals

- No backend-side server rendering
- No microservice split
- No hard dependency on external queue/worker infrastructure
