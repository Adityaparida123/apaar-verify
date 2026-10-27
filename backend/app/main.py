import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError

from app.config import get_settings
from app.database import close_database, ensure_indexes, get_database
from app.routes import audit, auth, dashboard, health, impacts, review_tasks, students, verification

logger = logging.getLogger("apaar_verify")
TIMED_ENDPOINTS = {
    "/api/v1/auth/login": "auth.login_request",
    "/api/v1/auth/google": "auth.google_login_request",
    "/api/v1/auth/me": "auth.me_request",
    "/api/v1/dashboard/summary": "dashboard.initial_load_request",
}


def create_app(database_override: Any = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if database_override is not None:
            ensure_indexes(database_override)
            app.state.database_indexes_ready = True
        else:
            try:
                database = get_database()
                database.command("ping")
                ensure_indexes(database)
                app.state.database_indexes_ready = True
            except (RuntimeError, PyMongoError):
                logger.warning("Database unavailable during startup; readiness will remain false")
        yield
        if database_override is None:
            close_database()

    app = FastAPI(
        title="APAAR Verify API",
        description="Prototype student-record management and deterministic correction impact review.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.database_override = database_override
    app.state.database_indexes_ready = False

    @app.exception_handler(PyMongoError)
    async def handle_database_error(_: Request, __: PyMongoError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "Database is unavailable"})

    @app.middleware("http")
    async def time_auth_and_dashboard_requests(request: Request, call_next):
        endpoint = TIMED_ENDPOINTS.get(request.url.path)
        if endpoint is None:
            return await call_next(request)
        started_at = time.perf_counter()
        try:
            return await call_next(request)
        finally:
            duration_ms = (time.perf_counter() - started_at) * 1000
            logger.info("request_timing endpoint=%s duration_ms=%.2f", endpoint, duration_ms)

    origin = get_settings().frontend_origin
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[item.strip() for item in origin.split(",") if item.strip()],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "If-Match"],
    )
    for route_module in (health, auth, students, impacts, review_tasks, dashboard, audit, verification):
        app.include_router(route_module.router)
    return app


app = create_app()
