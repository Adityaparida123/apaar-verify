from typing import Any

from fastapi import APIRouter, Depends, Query

from app.dependencies import database_dependency, require_roles
from app.models.common import Role
from app.services.intake_service import calculate_intake

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])
DASHBOARD_ROLES = (Role.institution_admin, Role.aicte_official)


def _institution_scope(user: dict[str, Any]) -> str | None:
    return user.get("institution_id") if user["role"] == Role.institution_admin.value else None


@router.get("/intake")
def intake(
    institution_id: str | None = None,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*DASHBOARD_ROLES)),
) -> dict[str, Any]:
    if user["role"] == Role.institution_admin.value:
        institution_id = user["institution_id"]
    comparisons = calculate_intake(database, institution_id)
    return {"items": comparisons}


@router.get("/summary")
def summary(
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*DASHBOARD_ROLES)),
) -> dict[str, Any]:
    institution_id = _institution_scope(user)
    student_query: dict[str, Any] = {"status": "active"}
    task_query: dict[str, Any] = {"status": "open"}
    audit_query: dict[str, Any] = {}
    if institution_id:
        student_query["institution_id"] = institution_id
        task_query["institution_id"] = institution_id
        audit_query["institution_id"] = institution_id
    intake_items = calculate_intake(database, institution_id)
    institutions_count = database.institutions.count_documents(
        {"institution_id": institution_id} if institution_id else {}
    )
    recent = list(database.audit_logs.find(audit_query, {"_id": 0}).sort("timestamp", -1).limit(10))
    return {
        "total_active_students": database.students.count_documents(student_query),
        "total_registered_institutions": institutions_count,
        "approved_intake": sum(item["approved_intake"] or 0 for item in intake_items),
        "actual_enrolment": sum(item["actual_enrolment"] for item in intake_items),
        "remaining_capacity": sum(item["remaining_capacity"] or 0 for item in intake_items),
        "excess_enrolment": sum(item["excess_enrolment"] or 0 for item in intake_items),
        "records_needing_review": len(
            database.review_tasks.distinct(
                "affected_record_id",
                {
                    **({"institution_id": institution_id} if institution_id else {}),
                    "status": {"$in": ["open", "in_progress"]},
                    "affected_record_id": {"$ne": None},
                },
            )
        ),
        "open_review_tasks": database.review_tasks.count_documents(task_query),
        "intake_comparisons": intake_items,
        "recent_changes": recent,
    }
