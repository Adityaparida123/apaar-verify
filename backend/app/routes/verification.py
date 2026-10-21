from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from pymongo.errors import PyMongoError

from app.dependencies import database_dependency, require_roles
from app.models.common import APIModel, Role
from app.security import random_verification_token, verification_token_hash
from app.services.audit_service import audit_event

router = APIRouter(tags=["verification"])
ISSUER_ROLES = (Role.institution_admin, Role.aicte_official)
ALLOWED_CLAIMS = ("status", "institution_id", "programme", "academic_year", "issued_at")


class TokenRequest(APIModel):
    record_id: str = Field(min_length=1, max_length=64)
    expires_in_days: int = Field(default=30, ge=1, le=365)


@router.post("/api/v1/verification-tokens", status_code=201)
def issue_token(
    payload: TokenRequest,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*ISSUER_ROLES)),
) -> dict[str, Any]:
    record = database.students.find_one({"record_id": payload.record_id})
    if record is None:
        raise HTTPException(status_code=404, detail="Student record not found")
    if user["role"] == Role.institution_admin.value and record["institution_id"] != user["institution_id"]:
        raise HTTPException(status_code=403, detail="Institution access denied")
    raw_token = random_verification_token()
    token_id = str(uuid4())
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=payload.expires_in_days)
    try:
        with database.client.start_session() as session:
            with session.start_transaction():
                database.verification_tokens.insert_one(
                    {
                        "token_id": token_id,
                        "token_hash": verification_token_hash(raw_token),
                        "record_id": record["record_id"],
                        "claims": list(ALLOWED_CLAIMS),
                        "issued_at": now,
                        "expires_at": expires_at,
                        "revoked_at": None,
                        "stale": False,
                    },
                    session=session,
                )
                database.audit_logs.insert_one(
                    audit_event(user, "verification.issue", target_record_id=record["record_id"],
                                institution_id=record["institution_id"]),
                    session=session,
                )
    except (PyMongoError, NotImplementedError, AttributeError) as exc:
        raise HTTPException(status_code=503, detail="Credential was not issued: MongoDB transactions are required") from exc
    return {"token_id": token_id, "token": raw_token, "expires_at": expires_at,
            "notice": "Verification is against the APAAR Verify prototype database, not an official APAAR or AICTE service."}


@router.get("/api/v1/verify/{token}")
def verify(token: str, database: Any = Depends(database_dependency)) -> dict[str, Any]:
    token_record = database.verification_tokens.find_one(
        {"token_hash": verification_token_hash(token)}, {"_id": 0}
    )
    if token_record is None:
        raise HTTPException(status_code=404, detail="Verification credential not found")
    now = datetime.now(UTC)
    if token_record.get("revoked_at") or token_record["expires_at"] <= now:
        raise HTTPException(status_code=410, detail="Verification credential is expired or revoked")
    if token_record.get("stale"):
        return {"valid": False, "status": "requires_revalidation", "claims": {},
                "notice": "The underlying record changed; request a reissued credential."}
    record = database.students.find_one(
        {"record_id": token_record["record_id"]},
        {"_id": 0, "status": 1, "institution_id": 1, "programme": 1, "academic_year": 1},
    )
    if record is None:
        raise HTTPException(status_code=410, detail="The verified record is no longer active")
    claims = {key: record[key] for key in ALLOWED_CLAIMS if key in record}
    claims["issued_at"] = token_record["issued_at"]
    return {"valid": True, "claims": claims,
            "notice": "Verification is against the APAAR Verify prototype database, not an official APAAR or AICTE service."}


@router.post("/api/v1/verification-tokens/{token_id}/revoke")
def revoke_token(
    token_id: str,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*ISSUER_ROLES)),
) -> dict[str, str]:
    query: dict[str, Any] = {"token_id": token_id}
    if user["role"] == Role.institution_admin.value:
        student_records = database.students.find(
            {"institution_id": user["institution_id"]}, {"record_id": 1, "_id": 0}
        )
        query["record_id"] = {"$in": [item["record_id"] for item in student_records]}
    token_record = database.verification_tokens.find_one(query)
    if token_record is None:
        raise HTTPException(status_code=404, detail="Verification credential not found")
    try:
        with database.client.start_session() as session:
            with session.start_transaction():
                database.verification_tokens.update_one(
                    {"token_id": token_id}, {"$set": {"revoked_at": datetime.now(UTC)}}, session=session
                )
                database.audit_logs.insert_one(
                    audit_event(user, "verification.revoke", target_record_id=token_record["record_id"]),
                    session=session,
                )
    except (PyMongoError, NotImplementedError, AttributeError) as exc:
        raise HTTPException(status_code=503, detail="Credential was not revoked: MongoDB transactions are required") from exc
    return {"status": "revoked"}
