from typing import Any
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.dependencies import current_user, database_dependency
from app.models.auth import GoogleLoginRequest, LoginRequest, TokenResponse, UserResponse
from app.security import create_access_token, verify_password
from app.services.google_auth_service import GoogleIdentityError, verify_google_identity

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])


def _login_response(user: dict[str, Any], database: Any, action: str) -> dict[str, Any]:
    token, expires_in = create_access_token(user)
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
    user = database.users.find_one({"email_normalized": email, "active": True})
    if user is None or not verify_password(payload.password, user["password_hash"]):
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
    user = database.users.find_one({"email_normalized": email, "active": True})
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid Google credentials")
    return _login_response(user, database, "auth.google_login")


@router.get("/me", response_model=UserResponse)
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {key: user[key] for key in ("user_id", "email", "role", "institution_id")}
