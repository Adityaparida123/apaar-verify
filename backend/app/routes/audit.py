from typing import Any

from fastapi import APIRouter, Depends, Query

from app.dependencies import database_dependency, require_roles
from app.models.common import Role

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])


@router.get("")
def audit(
    target_record_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(Role.institution_admin, Role.aicte_official)),
) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if user["role"] == Role.institution_admin.value:
        query["institution_id"] = user["institution_id"]
    if target_record_id:
        query["target_record_id"] = target_record_id
    total = database.audit_logs.count_documents(query)
    items = list(database.audit_logs.find(query, {"_id": 0}).sort("timestamp", -1).skip((page - 1) * page_size).limit(page_size))
    return {"items": items, "page": page, "page_size": page_size, "total": total}
