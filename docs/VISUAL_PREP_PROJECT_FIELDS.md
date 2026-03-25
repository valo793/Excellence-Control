# Visual Prep: Project Fields and Monthly Earnings

This checklist maps frontend touchpoints that consume project APIs and should be considered in the next visual pass.

## APIs Already Wired

- `GET /api/projects` now includes:
  - `metrics`
  - `goeKaizenAward`
  - `premioKaizen`
  - `categoriaBoletimExop`
  - `projectLinkId`
  - `ganhoRealizado` derived from monthly earnings sum when available
- Monthly earnings endpoints available:
  - `GET /api/projects/:id/earnings`
  - `POST /api/projects/:id/earnings`
  - `PUT /api/projects/:id/earnings`
  - `DELETE /api/projects/:id/earnings/:year/:month`

## Frontend Files Ready for Visual Work

- `src/components/ProjectForm.jsx`
  - New fields exposed in form.
  - Monthly earnings editor added.
  - Realized gain now treated as derived total from monthly rows.
- `src/App.jsx`
  - Project modal load fetches monthly earnings.
  - Save flow syncs monthly earnings through API.
- `src/components/ImportSpreadsheetModal.jsx`
  - CSV/XLSX mapping supports new project fields.
  - Template updated with new columns.
- `src/views/TableView.jsx`
  - `ganhoRealizado` no longer editable inline (derived field).
- `Server/index.js`
  - Bulk import normalization supports new fields for project rows.

## Visual-Focused Next Pass

- Apply visual hierarchy and spacing for the new form blocks:
  - Methodology fields (`metrics`, awards, boletim category, project link).
  - Monthly earnings list + total summary.
- Update table visual labels/density for derived `ganhoRealizado`.
- Keep CSV import UX styling aligned with design system for added mappings.
