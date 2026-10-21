import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import HTTPException
from pwdlib import PasswordHash

from app.config import get_settings

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, password_digest: str) -> bool:
    return password_hash.verify(password, password_digest)


def create_access_token(user: dict[str, Any]) -> tuple[str, int]:
    secret = get_settings().jwt_secret
    if not secret or len(secret) < 32:
        raise HTTPException(status_code=503, detail="JWT_SECRET must be configured with at least 32 characters")
    expires_in = get_settings().jwt_expire_minutes * 60
    now = datetime.now(UTC)
    token = jwt.encode(
        {"sub": user["user_id"], "iat": now, "exp": now + timedelta(seconds=expires_in)},
        secret,
        algorithm="HS256",
    )
    return token, expires_in


def decode_access_token(token: str) -> dict[str, Any]:
    secret = get_settings().jwt_secret
    if not secret or len(secret) < 32:
        raise HTTPException(status_code=503, detail="JWT_SECRET must be configured with at least 32 characters")
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        if not isinstance(payload.get("sub"), str):
            raise jwt.InvalidTokenError("Missing subject")
        return payload
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired access token") from exc


def identifier_hash(identifier: str) -> str:
    secret = get_settings().jwt_secret
    if not secret or len(secret) < 32:
        raise HTTPException(status_code=503, detail="JWT_SECRET must be configured with at least 32 characters")
    key = hashlib.sha256(secret.encode("utf-8")).digest()
    normalized = "".join(identifier.split())
    return hmac.new(key, normalized.encode("utf-8"), hashlib.sha256).hexdigest()


def random_verification_token() -> str:
    return secrets.token_urlsafe(32)


def verification_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
