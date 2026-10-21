# APAAR Verify frontend

Next.js App Router frontend for the existing FastAPI backend. The frontend uses only the backend routes in its OpenAPI schema; it does not contain Gemini, MongoDB, or JWT signing secrets.

## Local development

1. Start the backend from `backend` using its documented setup and `uvicorn app.main:app --reload`.
2. In this directory, install dependencies and create the local environment file:

   ```powershell
   npm install
   Copy-Item .env.example .env.local
   ```

3. Set `NEXT_PUBLIC_API_URL` in `.env.local` to the backend origin, without a trailing slash. The default is `http://localhost:8000`.
4. Run `npm run dev` and open `http://localhost:3000`.

The backend's `FRONTEND_ORIGIN` must include `http://localhost:3000` for local CORS. For deployment, configure `NEXT_PUBLIC_API_URL` in Vercel for the relevant environments and set the matching deployed frontend origin in the backend's `FRONTEND_ORIGIN`.

## Backend-supported features and limitations

The UI integrates login/current-user, student list/detail, deterministic correction preview and apply, review tasks, dashboard summary/intake, audit events, and verification-token issue/revoke/verify. The API does not expose version-history listing or a verification-token listing endpoint; the UI states these limitations and only offers revocation for a token just issued in the current session. Review and management routes are restricted to `institution_admin` and `aicte_official` roles as enforced by the backend.

The backend uses bearer JWTs, so the browser keeps the access token in session storage and sends it through the shared API client. This is not a substitute for backend authorization. Verifier accounts do not have access to the administrative routes.
