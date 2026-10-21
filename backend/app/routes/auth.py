from typing import Any
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import current_user, database_dependency
from app.models.auth import LoginRequest, TokenResponse, UserResponse
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, database: Any = Depends(database_dependency)) -> dict[str, Any]:
    email = str(payload.email).casefold()
    user = database.users.find_one({"email_normalized": email, "active": True})
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token, expires_in = create_access_token(user)
    database.audit_logs.insert_one(
        {
            "actor_id": user["user_id"],
            "actor_role": user["role"],
            "action": "auth.login",
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


@router.get("/me", response_model=UserResponse)
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {key: user[key] for key in ("user_id", "email", "role", "institution_id")}
