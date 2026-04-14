# IIS Frontend Migration Changes

Date: 2026-03-25

## What was implemented

- The frontend keeps using Vite for development and build, but production publishing is now designed for IIS serving the generated `dist/` folder.
- Production builds now require `VITE_API_URL` and validate it as a real `https://` production origin.
- `localhost` and non-HTTPS API URLs are blocked during production build to avoid publishing a broken bundle.
- Frontend API calls and attachment download URLs now use the same base URL resolution logic.
- `public/web.config` was added so IIS can:
  - rewrite SPA routes like `/verify-email` to `index.html`
  - disable cache for `index.html`
  - cache `/assets/*` aggressively
  - enable static/dynamic compression directives at the IIS layer
- Example environment files were added:
  - `.env.production.example`
  - `Server/.env.production.example`
- Documentation was updated for frontend hosting and backend production configuration.

## Documentation reorganization

- Core docs were moved to `docs/reference/`:
  - `ARCHITECTURE.md`
  - `BACKEND.md`
  - `FRONTEND.md`
  - `DATABASE.md`
- Working/planning docs were moved to `docs/notes/`.
- `docs/README.md` was added as the documentation index.

## What changed for dev testing

Local development flow is almost the same:

1. Keep using `.env.local`.
2. Keep using `npm run dev` for the frontend.
3. Keep running the backend separately in `Server/`.

Important local behavior now:

- Dev still allows `VITE_API_URL=http://localhost:3001`.
- The production build rules do not block local `npm run dev`.
- Attachment URLs now follow the same API base as the rest of the frontend calls, so local file download tests should behave more consistently.

## What you should test in dev

### Frontend and routing

- Open the app normally in dev.
- Navigate through login, landing, Kanban, Dashboard, Roadmap and Table.
- Open `/verify-email?token=teste` and confirm the verify screen still renders correctly in the SPA flow.

### Auth and session

- Login with and without `rememberMe`.
- Refresh the page after login.
- Logout and confirm session cleanup.
- Confirm expired/invalid token behavior still redirects safely.

### Attachments

- Upload a file to a project.
- List existing attachments.
- Download an attachment.
- Remove an attachment.

### API integration

- Fetch projects, dashboard metrics and admin pages.
- Validate that network requests point to the expected API origin.

## What you need to know for production implementation

### Frontend build

You must provide a real production API origin before building:

```env
VITE_API_URL=https://api.your-corporate-domain
```

Production build now fails if:

- `VITE_API_URL` is missing
- `VITE_API_URL` is not a valid absolute URL
- `VITE_API_URL` does not use `https://`
- `VITE_API_URL` points to localhost

### Backend environment

At minimum, production backend config must align with the IIS frontend URL:

```env
NODE_ENV=production
APP_WEB_URL=https://frontend.your-corporate-domain
CORS_ORIGIN=https://frontend.your-corporate-domain
REFRESH_COOKIE_SECURE=true
REFRESH_COOKIE_SAMESITE=Lax
```

### IIS publishing model

- Publish only the generated `dist/` folder to IIS.
- The current setup assumes the frontend is hosted at the IIS site root (`/`), not a virtual subdirectory.
- Ensure the IIS server has URL Rewrite installed.
- `web.config` must be deployed together with the frontend files.

### Uploads and backend ownership

- Uploads are still served by the Node/Express API.
- IIS is not serving `/uploads` in this phase.
- The backend remains responsible for attachment URLs, CORS and refresh-cookie behavior.

## Validation already performed

- Production build was verified to fail when `VITE_API_URL` came from local `http://localhost:3001`.
- Production build was verified to pass with an explicit HTTPS API URL.
- `dist/web.config` was confirmed to be included in the build artifact.
- The generated bundle was confirmed to embed the configured HTTPS API base.

## Known remaining considerations

- The main JS bundle is still large.
- Several image assets are very heavy.
- These do not block IIS deployment, but they still matter for first-load performance and should be treated as a future optimization pass.
