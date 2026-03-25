# Frontend Guide

## Stack

- React 18 + Vite
- Tailwind CSS + custom design tokens/classes
- `lucide-react` for icons
- `frappe-gantt` for timeline rendering
- `chart.js` + `react-chartjs-2` for analytics
- `papaparse` + `xlsx` for spreadsheet import/export UX

## Structure

```text
src/
  App.jsx                    # App shell, global state orchestration
  main.jsx
  config/
    oracle.js                # API client and auth token persistence
  ui/
    visuals.js               # Reusable visual class map/tokens
  styles/
    index.css                # Theme variables and component-level CSS primitives
  components/
    Header.jsx
    Sidebar.jsx
    FiltersPopup.jsx
    Gantt.jsx
    Modal.jsx
    ProjectForm.jsx
    ImportSpreadsheetModal.jsx
    HowToGuide.jsx
    ...
  views/
    Kanban.jsx
    Dashboard.jsx
    Roadmap.jsx
    TableView.jsx
    AdminUsersView.jsx
    AdminAuditView.jsx
    AuthView.jsx
    Landing.jsx
    VerifyEmailView.jsx
```

## State model

`App.jsx` centralizes UI and data state:
- auth/user session and role gating
- current view
- modal visibility
- search/filtering
- settings (theme, language)
- project CRUD refresh and optimistic interactions

### Filter state

- Applied project filters are stored in local storage:
  - key: `ec_project_filters_v1`
- Header now exposes a single `Filters` entry point.
- Popup filter draft is applied explicitly with `Apply`.
- `Clear` resets all filter dimensions.

## UX system and theme

- Theme tokens are CSS variables in `src/styles/index.css`.
- Shared utility class map in `src/ui/visuals.js` prevents style drift.
- Input/button/card/choice states are standardized:
  - hover
  - focus-visible
  - active
  - disabled
  - error/loading variants

## Main views

### Kanban
- Status columns and drag-style status changes
- Card-level open/edit actions

### Dashboard
- KPI cards + charts
- Uses same global search/date filters for consistency

### Roadmap
- Gantt for scheduled items
- Unscheduled section with standardized cards and quick actions
- Status chips for timeline/unplanned filtering

### Table
- Dense editable table for field-level management

### Admin users
- Restricted to admin role
- Minimal header variant (sidebar toggle + theme toggle only)

### Admin audit
- Restricted to admin role
- Dedicated view for user audit history (`AdminAuditView.jsx`)
- Features:
  - paginated and filterable history
  - detail panel with field-level diff and JSON before/after
  - rollback confirmation modal for reversible entries

## Roadmap behavior (current implementation)

- Smart timeline compacting in `src/components/Gantt.jsx`:
  - computes range from real task dates
  - default upper bound reaches end of current year
  - auto-expands if data contains future planned end date
- `IN_PROGRESS` tasks show planned continuation:
  - remaining planned segment: gray
  - overdue segment (past estimated end): red
- Tooltip/popup includes real start/current/planned dates.

## Internationalization

- Current language toggle supports:
  - English (`en`) default
  - Portuguese Brazil (`pt-BR`)
- Translation approach is inline/local (`tr(en, ptBr)` pattern), not full i18n library.

## Auth token behavior

Implemented in `src/config/oracle.js`:
- Default login: token in `sessionStorage`
- `rememberMe=true`: token in `localStorage`
- Automatic token cleanup on API `401`

## Frontend troubleshooting

- Stale UI after API changes:
  - check `VITE_API_URL`
  - optional async import tuning:
    - `VITE_IMPORT_ASYNC_THRESHOLD` (default `250`)
    - `VITE_IMPORT_JOB_POLL_INTERVAL_MS` (default `1500`)
    - `VITE_IMPORT_JOB_TIMEOUT_MS` (default `600000`)
  - during async import, cancel uses backend job endpoint (`DELETE /api/projects/import/jobs/:jobId`)
  - inspect browser network responses
- Auth loop to login:
  - clear `ec_token` from local/session storage
- Theme inconsistencies:
  - verify root `.dark` class is toggled by settings effect
- Filter popup not reflecting expected data:
  - confirm filters were applied (not only edited in draft)
