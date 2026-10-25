# APAAR Verify

APAAR Verify is a prototype academic-record management platform with a FastAPI backend and a Next.js frontend. It supports student records, deterministic correction-impact previews, review tasks, audit history, intake reporting, and database-backed verification credentials. It is not an official APAAR or AICTE service; no official registry is queried.

## Project structure

- `backend/` — FastAPI API, MongoDB persistence, deterministic rules, and pytest suite.
- `frontend/` — Next.js App Router application.
- `render.yaml` — Render backend service blueprint.

## Local development

### Backend

Follow [backend/README.md](./backend/README.md) to configure the local environment and install Python dependencies. The backend requires a transaction-capable MongoDB deployment for correction writes.

From `backend/`, start the API:

```powershell
uvicorn app.main:app --reload
```

### Frontend

Follow [frontend/README.md](./frontend/README.md). Configure `NEXT_PUBLIC_API_URL` in `frontend/.env.local` with the backend origin, then run:

```powershell
npm install
npm run dev
```

## Configuration names

Backend configuration uses `MONGODB_URI`, `MONGODB_DATABASE`, `JWT_SECRET`, `JWT_EXPIRE_MINUTES`, `FRONTEND_ORIGIN`, and (for Google sign-in) `GOOGLE_CLIENT_ID`. Demo seeding additionally uses `DEMO_MODE`, `DEMO_ADMIN_PASSWORD`, `DEMO_OFFICIAL_PASSWORD`, and `DEMO_VERIFIER_PASSWORD`. `GEMINI_API_KEY` is reserved for a future backend integration and is not currently used. The frontend uses `NEXT_PUBLIC_API_URL` and the public `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; see the backend and frontend READMEs for OAuth setup.

The frontend uses `NEXT_PUBLIC_API_URL` for the backend origin. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is a public OAuth client ID. Do not put MongoDB credentials, JWT secrets, Gemini keys, or demo passwords in frontend configuration.

## Tests

Run backend tests from `backend/`:

```powershell
python -m pytest
```

Run frontend checks from `frontend/`:

```powershell
npm run typecheck
npm run lint
npm run build
npm audit
```
