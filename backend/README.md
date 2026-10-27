# APAAR Verify backend

Prototype FastAPI backend for student records, explainable correction impact reviews, review tasks, audit history, and database-backed verification. This is not an official APAAR or AICTE verification service. All seed data and approval references are fictional.

## Local setup

Requires Python 3.12+ and a MongoDB Atlas deployment (or a local replica set for transaction-backed correction writes).

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Replace the placeholders in the untracked `.env` file before connecting or starting the API. Set `MONGODB_URI` to your Atlas URI for the `apaar_verify` database. Use a password manager or cryptographically secure local generator for `JWT_SECRET` and write it directly to `.env` without printing it; do not copy example values into a deployed service. Demo account passwords are only needed when you explicitly seed demo data; use unique values of at least 12 characters. A correction is committed as one MongoDB transaction, so use Atlas or another transaction-capable replica set. The application does not substitute in-memory storage when MongoDB is unavailable.

```powershell
uvicorn app.main:app --reload
```

The interactive API documentation is at `http://localhost:8000/docs`; root, health, and readiness checks are `/`, `/health`, and `/ready`. `/health` separates API availability from MongoDB connectivity. `/ready` returns HTTP 503 when MongoDB is not reachable.

Authentication and initial dashboard requests emit data-free timing records through the `apaar_verify` logger: `request_timing` for login, Google login, `/auth/me`, and dashboard summary; and `auth_timing` for MongoDB account lookup, Argon2 verification, and JWT creation. Records contain only a fixed stage/endpoint name and elapsed milliseconds—never credentials, tokens, cookies, account identifiers, or student data. The browser records `apaar.auth.*_request`, `apaar.dashboard.summary_request`, and `apaar.dashboard.initial_load` measures in the Performance Timeline; these are not transmitted. Authentication requests time out after 10 seconds and dashboard summary after 15 seconds, with loading state cleared on errors and timeouts. The API no longer pings MongoDB before every request: normal database operation errors return HTTP 503, while `/health` and `/ready` continue to probe database connectivity explicitly.

Student URL parameters and verification-token issuance use the generated `record_id` returned by student create/list responses. The separately supplied `student_id` is unique within its institution namespace and is not used as the route key.

## Environment variables

See [.env.example](./.env.example). `MONGODB_URI` and `JWT_SECRET` are required for database-backed authenticated APIs. `MONGODB_DATABASE`, `JWT_EXPIRE_MINUTES`, and `FRONTEND_ORIGIN` have safe local defaults. `GOOGLE_CLIENT_ID` is the public OAuth client ID used to verify Google sign-in; password login remains available when it is unset. `DEMO_MODE` does not bypass authorization. CSV upload defaults to a 2 MiB size limit and 1,000 rows.

`GEMINI_API_KEY` is a backend-only placeholder for a future Gemini integration. The current backend does not call Gemini or consume this key; leave it unset until that integration is implemented. If configured for local development later, keep the key only in the ignored `backend/.env` file. Gemini is intended only to explain inconsistencies already detected by deterministic rules and summarize review findings; authorization, human approval, and record or verification decisions remain independent of AI.

The seed command additionally requires `DEMO_MODE=true` and `DEMO_ADMIN_PASSWORD`, `DEMO_OFFICIAL_PASSWORD`, and `DEMO_VERIFIER_PASSWORD` (each at least 12 characters). `.env.example` contains placeholders for these values; replace them locally and never commit real passwords. These values are loaded through the same Pydantic settings source as the other `.env` entries. Keep `DEMO_MODE=false` for non-demo deployments; this flag only gates demo seeding and never bypasses API authorization.

## MongoDB Atlas

Create an Atlas cluster, database user, and network access rule for the backend host. Copy the SRV connection string into `MONGODB_URI` without committing it. Database indexes are created on application startup. Atlas supports transactions; a standalone MongoDB server does not.

## Demo data

From `backend`, run:

```powershell
python -m scripts.seed_demo
```

The command upserts fictional sample data. To clear collections used by the demo and reseed, set `DEMO_MODE=true`, use a database name containing `demo` or `test` (for example `apaar_verify_demo`), and explicitly pass `--reset`. The script refuses to reset other database names. Never point it at a production database. Synthetic APAAR-like identifiers are HMAC-hashed before storage. Accounts are the configured `DEMO_ADMIN_EMAIL` (default `admin@example.test`), `official@example.test`, and `verifier@example.test`; set their passwords via the environment variables described above.

## Tests

```powershell
python -m pytest
```

Tests use isolated in-memory MongoDB mocks and do not connect to or delete an Atlas database.

## Render and frontend

The repository-root [render.yaml](../render.yaml) blueprint runs Uvicorn with `/ready` as its health check. Enter `MONGODB_URI` and the exact deployed frontend `FRONTEND_ORIGIN` in Render's environment settings; Render generates `JWT_SECRET`. Enter `GEMINI_API_KEY` in the Render dashboard as a secret environment variable only when you are authorized to configure it; the current backend does not use it yet. The blueprint sets `MONGODB_DATABASE=apaar_verify`, `JWT_EXPIRE_MINUTES=60`, `DEMO_MODE=false`, and the demo admin email. Set `FRONTEND_ORIGIN` to the exact deployed Vercel origin (or a comma-separated list of explicit origins); do not use `*` with credentials enabled. Do not configure demo passwords in a production service unless there is a deliberate, isolated demo need. The backend does not claim live Atlas or Render connectivity until configured and deployed.

The Next.js frontend is in the repository-root `frontend/` directory. Configure `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in its local `.env.local` file or in Vercel. Set `GOOGLE_CLIENT_ID` in Render to the same Google OAuth client ID; that ID is public, and this ID-token flow requires no OAuth client secret. Set the Google OAuth client's authorized JavaScript origins to the exact local (`http://localhost:3000`) and deployed Vercel origins used by this app. No redirect URI is needed for the GIS popup flow. The backend's `FRONTEND_ORIGIN` must include the matching frontend origin. Do not expose backend secrets or the MongoDB URI to the browser.

To set up Google sign-in, configure the Google OAuth consent screen and create a Web application OAuth client in Google Cloud Console. Add the exact local and production frontend origins as authorized JavaScript origins. Copy the resulting client ID to `GOOGLE_CLIENT_ID` in the backend environment and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the frontend environment. Locally, put the first in `backend/.env` and the second in `frontend/.env.local`; in deployment, set them in Render and Vercel respectively. Redeploy both services after setting their variables, then test with a Google email that matches an existing active APAAR Verify account. The backend never creates accounts from Google identities.

## Prototype limitations

- APAAR identifiers are validated for a 12-digit shape only and stored as keyed hashes; syntax is not official identity verification.
- Correction writes require MongoDB transaction support and return an explicit service error if transactions are unavailable.
- No external APAAR, AICTE, or institution registry is queried.
- Gemini is not integrated; no Gemini API calls are made, and any configured API key is currently unused.
- Intake rules use only the explicit programme/year limits configured in the institution document; unconfigured policy is assigned to human review.
- If a programme configures year-specific intake values, an academic year absent from that map is treated as unconfigured; the global intake is not substituted for that year.
