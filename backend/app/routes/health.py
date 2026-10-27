from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import PyMongoError

from app.database import database_status
from app.dependencies import database_dependency

router = APIRouter(tags=["health"])


@router.get("/")
def root() -> dict[str, str]:
    return {"name": "APAAR Verify API", "status": "available"}


@router.get("/health")
def health(request: Request) -> dict[str, object]:
    connected = request.app.state.database_override is not None or database_status()
    return {"api": "available", "database": "connected" if connected else "unavailable"}


@router.get("/ready")
def ready(database: Any = Depends(database_dependency)) -> dict[str, str]:
    try:
        database.command("ping")
    except (RuntimeError, PyMongoError) as exc:
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ready"}
