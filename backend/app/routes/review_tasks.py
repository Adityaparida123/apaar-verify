from typing import Any
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import PyMongoError

from app.dependencies import database_dependency, require_roles
from app.models.common import Role
from app.models.review_task import ReviewTaskUpdate
from app.services.audit_service import audit_event

router = APIRouter(prefix="/api/v1/review-tasks", tags=["review tasks"])
REVIEW_ROLES = (Role.institution_admin, Role.aicte_official)


def _scope(user: dict[str, Any]) -> dict[str, Any]:
    return {"institution_id": user["institution_id"]} if user["role"] == Role.institution_admin.value else {}


@router.get("")
def list_tasks(
    status: str | None = None,
    severity: str | None = None,
    assessment_id: str | None = None,
    institution_id: str | None = None,
    academic_year: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*REVIEW_ROLES)),
) -> dict[str, Any]:
    query = _scope(user)
    if institution_id and user["role"] == Role.aicte_official.value:
        query["institution_id"] = institution_id
    for key, value in (("status", status), ("severity", severity), ("assessment_id", assessment_id)):
        if value:
            query[key] = value
    if academic_year:
        record_ids = [
            item["record_id"]
            for item in database.students.find(
                {"academic_year": academic_year, **({"institution_id": query["institution_id"]} if query.get("institution_id") else {})},
                {"record_id": 1, "_id": 0},
            )
        ]
        query["affected_record_id"] = {"$in": record_ids}
    total = database.review_tasks.count_documents(query)
    items = list(database.review_tasks.find(query, {"_id": 0}).sort([("priority", 1), ("created_at", -1)]).skip((page - 1) * page_size).limit(page_size))
    return {"items": items, "page": page, "page_size": page_size, "total": total}


@router.get("/{task_id}")
def get_task(
    task_id: str,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*REVIEW_ROLES)),
) -> dict[str, Any]:
    task = database.review_tasks.find_one({"task_id": task_id, **_scope(user)}, {"_id": 0})
    if task is None:
        raise HTTPException(status_code=404, detail="Review task not found")
    return task


@router.patch("/{task_id}")
def update_task(
    task_id: str,
    payload: ReviewTaskUpdate,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*REVIEW_ROLES)),
) -> dict[str, Any]:
    task = database.review_tasks.find_one({"task_id": task_id, **_scope(user)})
    if task is None:
        raise HTTPException(status_code=404, detail="Review task not found")
    if payload.status == "resolved" and not payload.outcome:
        raise HTTPException(status_code=422, detail="A resolved task requires an outcome")
    try:
        with database.client.start_session() as session:
            with session.start_transaction():
                database.review_tasks.update_one(
                    {"task_id": task_id},
                    {"$set": {
                        "status": payload.status,
                        "review_note": payload.review_note,
                        "outcome": payload.outcome,
                        "assigned_reviewer": task.get("assigned_reviewer") or user["user_id"],
                        "updated_at": datetime.now(UTC),
                    }},
                    session=session,
                )
                database.audit_logs.insert_one(
                    audit_event(
                        user, f"review_task.{payload.status}", target_record_id=task.get("affected_record_id"),
                        institution_id=task["institution_id"], changed_fields=["status", "review_note", "outcome"],
                        reason=payload.review_note,
                    ),
                    session=session,
                )
    except (PyMongoError, NotImplementedError, AttributeError) as exc:
        raise HTTPException(status_code=503, detail="Review update was not committed: MongoDB transactions are required") from exc
    return database.review_tasks.find_one({"task_id": task_id}, {"_id": 0})
