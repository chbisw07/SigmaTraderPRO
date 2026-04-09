# ML1 Sprint 2 Implementation Notes

## S2.1 Auth Backend + Schema

### Completed
- Added `users` table schema with `last_used_broker` preference field
- Added Alembic migration for auth schema
- Implemented JWT access + refresh token flow (`/api/v1/auth/login`, `/api/v1/auth/refresh`)
- Implemented minimal registration (`/api/v1/auth/register`) for local/dev bootstrap
- Implemented protected identity endpoint (`/api/v1/auth/me`) and a minimal preferences update endpoint
- Added auth service layer (password hashing + token issuance + token validation) and reusable `get_current_user` dependency
- Added focused tests for login/refresh/me, preferences update, and Alembic migration upgrade smoke

### Important highlights
- API versioning follows frozen PRD convention: all application endpoints live under `/api/v1/...`
- Refresh token rotation is “stateless”: a new refresh token is issued, but old refresh tokens cannot be invalidated yet (no revocation store in S2.1)
- Logging follows S1.5 conventions: no raw passwords, no raw tokens, and no secrets in logs

### Next
- S2.2 frontend shell + status bar consuming `/api/v1/auth/me` and refresh flow
- S3.x broker adapter + broker settings (will start using `last_used_broker`)

---

## S2.2 Frontend Shell + Status Bar

### Completed
- Added a minimal login page (`/login`) with email+password form, loading state, and error feedback
- Implemented protected routing so all workspace routes require auth; unauthenticated access redirects to `/login`
- Added auth state store (Zustand + localStorage persistence) for access/refresh tokens and current user identity
- Added auth bootstrap on app load: uses `/api/v1/auth/me` when possible, falls back to `/api/v1/auth/refresh` when needed
- Activated a basic user menu (shows current email + logout) in the existing shell header
- Added a persistent status bar scaffold wired to backend `/health` and frontend auth state
- Added focused frontend tests for login render, route guard redirect, and login redirect-back behavior

### Important highlights
- Frontend consumes the S2.1 backend auth contract directly:
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `GET /api/v1/auth/me`
- API base URL is env-driven via `VITE_API_BASE_URL`
  - default: empty (relative URLs via Vite proxy to `http://127.0.0.1:8000`)
  - if set: backend must allow CORS for the frontend origin
- No registration UI was added (intentionally); backend dev bootstrap remains available via `POST /api/v1/auth/register`

### Next
- Add automatic refresh-on-401 retry helper for future protected API calls (when real API integration begins)
- Extend status bar items for broker connectivity and dispatch gating in S3+
