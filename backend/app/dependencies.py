from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.errors import PyMongoError

from app.database import ensure_indexes, get_database
from app.models.common import Role
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)


def database_dependency(request: Request) -> Any:
    if request.app.state.database_override is not None:
        return request.app.state.database_override
    try:
        database = get_database()
        database.command("ping")
        if not request.app.state.database_indexes_ready:
            ensure_indexes(database)
            request.app.state.database_indexes_ready = True
        return database
    except (RuntimeError, PyMongoError) as exc:
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    database: Any = Depends(database_dependency),
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    payload = decode_access_token(credentials.credentials)
    user = database.users.find_one({"user_id": payload["sub"], "active": True})
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or inactive user")
    return user


def require_roles(*roles: Role):
    def dependency(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        if user.get("role") not in {role.value for role in roles}:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user

    return dependency


def require_institution_access(user: dict[str, Any], institution_id: str) -> None:
    if user["role"] == Role.aicte_official.value:
        return
    if user.get("institution_id") != institution_id:
        raise HTTPException(status_code=403, detail="Institution access denied")
