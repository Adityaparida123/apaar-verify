from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import database_dependency, require_roles
from app.models.common import Role

router = APIRouter(prefix="/api/v1/impacts", tags=["impact assessments"])
REVIEW_ROLES = (Role.institution_admin, Role.aicte_official)


def _scope(user: dict[str, Any]) -> dict[str, Any]:
    return {"institution_id": user["institution_id"]} if user["role"] == Role.institution_admin.value else {}


@router.get("")
def assessments(
    institution_id: str | None = None,
    severity: str | None = None,
    status: str | None = None,
    academic_year: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*REVIEW_ROLES)),
) -> dict[str, Any]:
    query = _scope(user)
    if institution_id and user["role"] == Role.aicte_official.value:
        query["institution_id"] = institution_id
    if status:
        query["status"] = status
    items = list(database.impact_assessments.find(query, {"_id": 0}).sort("created_at", -1))
    if severity:
        items = [
            assessment for assessment in items
            if any(finding["severity"] == severity for finding in assessment.get("findings", []))
        ]
    if academic_year:
        records = database.students.find(
            {"academic_year": academic_year, "institution_id": query.get("institution_id", {"$exists": True})},
            {"record_id": 1, "_id": 0},
        )
        record_ids = {item["record_id"] for item in records}
        items = [assessment for assessment in items if assessment["record_id"] in record_ids]
    total = len(items)
    return {"items": items[(page - 1) * page_size:page * page_size], "page": page, "page_size": page_size, "total": total}


@router.get("/{assessment_id}")
def assessment(
    assessment_id: str,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*REVIEW_ROLES)),
) -> dict[str, Any]:
    item = database.impact_assessments.find_one(
        {"assessment_id": assessment_id, **_scope(user)}, {"_id": 0}
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Impact assessment not found")
    return item


@router.get("/{assessment_id}/tasks")
def assessment_tasks(
    assessment_id: str,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*REVIEW_ROLES)),
) -> list[dict[str, Any]]:
    assessment_item = database.impact_assessments.find_one(
        {"assessment_id": assessment_id, **_scope(user)}, {"_id": 0, "assessment_id": 1}
    )
    if assessment_item is None:
        raise HTTPException(status_code=404, detail="Impact assessment not found")
    return list(database.review_tasks.find({"assessment_id": assessment_id}, {"_id": 0}).sort("priority", 1))
