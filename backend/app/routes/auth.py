import logging
import time
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.dependencies import current_user, database_dependency
from app.models.auth import GoogleLoginRequest, LoginRequest, TokenResponse, UserResponse
from app.security import DUMMY_PASSWORD_HASH, create_access_token, verify_password
from app.services.google_auth_service import GoogleIdentityError, verify_google_identity

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])
logger = logging.getLogger("apaar_verify")


def _log_auth_timing(stage: str, started_at: float) -> None:
    duration_ms = (time.perf_counter() - started_at) * 1000
    logger.info("auth_timing stage=%s duration_ms=%.2f", stage, duration_ms)


def _login_response(user: dict[str, Any], database: Any, action: str) -> dict[str, Any]:
    started_at = time.perf_counter()
    try:
        token, expires_in = create_access_token(user)
    finally:
        _log_auth_timing("jwt_creation", started_at)
    database.audit_logs.insert_one(
        {
            "actor_id": user["user_id"],
            "actor_role": user["role"],
            "action": action,
            "target_record_id": None,
            "institution_id": user.get("institution_id"),
            "changed_fields": [],
            "timestamp": datetime.now(UTC),
            "outcome": "success",
            "correlation_id": uuid4().hex,
            "reason": None,
        }
    )
    return {"access_token": token, "expires_in": expires_in}


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, database: Any = Depends(database_dependency)) -> dict[str, Any]:
    email = str(payload.email).casefold()
    started_at = time.perf_counter()
    try:
        user = database.users.find_one({"email_normalized": email, "active": True})
    finally:
        _log_auth_timing("mongodb_account_lookup", started_at)
    password_digest = user["password_hash"] if user is not None else DUMMY_PASSWORD_HASH
    started_at = time.perf_counter()
    try:
        password_valid = verify_password(payload.password, password_digest)
    finally:
        _log_auth_timing("argon2_verification", started_at)
    if user is None or not password_valid:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return _login_response(user, database, "auth.login")


@router.post("/google", response_model=TokenResponse)
def google_login(
    payload: GoogleLoginRequest,
    database: Any = Depends(database_dependency),
) -> dict[str, Any]:
    client_id = get_settings().google_client_id
    if not client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        email = verify_google_identity(payload.credential, client_id)
    except GoogleIdentityError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google credentials") from exc
    started_at = time.perf_counter()
    try:
        user = database.users.find_one({"email_normalized": email, "active": True})
    finally:
        _log_auth_timing("mongodb_account_lookup", started_at)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid Google credentials")
    return _login_response(user, database, "auth.google_login")


@router.get("/me", response_model=UserResponse)
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {key: user[key] for key in ("user_id", "email", "role", "institution_id")}
