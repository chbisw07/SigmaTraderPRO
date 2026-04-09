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
