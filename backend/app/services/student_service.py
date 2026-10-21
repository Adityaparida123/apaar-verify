from datetime import UTC, date, datetime, time
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.models.student import StudentCreate, StudentFields, StudentPatch
from app.security import identifier_hash
from app.services.audit_service import audit_event
from app.services.impact_engine import RELEVANT_CREDENTIAL_FIELDS, build_review_tasks, detect_impacts

SENSITIVE_FIELDS = {"apaar_identifier", "apaar_hash", "student_id_normalized", "_id"}


def public_student(document: dict[str, Any]) -> dict[str, Any]:
    item = {key: value for key, value in document.items() if key not in SENSITIVE_FIELDS}
    item.pop("created_at", None)
    item.pop("updated_at", None)
    if isinstance(item.get("admission_date"), datetime):
        item["admission_date"] = item["admission_date"].date()
    digest = document.get("apaar_hash")
    item["masked_apaar_identifier"] = "••••••••••••" if digest else None
    return item


def safe_record_values(document: dict[str, Any] | None) -> dict[str, Any] | None:
    if document is None:
        return None
    values = {key: value for key, value in document.items() if key not in SENSITIVE_FIELDS}
    if document.get("apaar_hash"):
        values["masked_apaar_identifier"] = "••••••••••••"
    return values


def _database_values(values: dict[str, Any]) -> dict[str, Any]:
    serialized = dict(values)
    if "apaar_identifier" in serialized:
        identifier = serialized.pop("apaar_identifier")
        serialized["apaar_hash"] = identifier_hash(identifier) if identifier else None
    return {
        key: datetime.combine(value, time.min, tzinfo=UTC) if isinstance(value, date) and not isinstance(value, datetime) else value
        for key, value in serialized.items()
    }


def _validate_merged(current: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    allowed = set(StudentFields.model_fields)
    candidate = {key: value for key, value in current.items() if key in allowed and key not in SENSITIVE_FIELDS}
    candidate["apaar_identifier"] = None
    candidate.update(changes)
    try:
        StudentFields.model_validate(candidate)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return candidate


def _linked_records(database: Any, current: dict[str, Any]) -> list[dict[str, Any]]:
    predicates = [
        {"record_id": current["record_id"]},
        {"student_id": current["student_id"], "institution_id": current["institution_id"]},
    ]
    if current.get("apaar_hash"):
        predicates.append({"apaar_hash": current["apaar_hash"]})
    return list(
        database.linked_records.find(
            {"$or": predicates},
            {"_id": 0},
        )
    )


def _enrolments(database: Any) -> dict[tuple[str, str, str], dict[str, int]]:
    result: dict[tuple[str, str, str], dict[str, int]] = {}
    for record in database.students.find({"status": "active"}):
        key = (record["institution_id"], record["programme"], record["academic_year"])
        counts = result.setdefault(key, {"regular": 0, "supernumerary": 0})
        counts["supernumerary" if record.get("supernumerary_seat_status") else "regular"] += 1
    return result


def _analyze(database: Any, current: dict[str, Any], candidate: dict[str, Any], changes: dict[str, Any]) -> list[dict[str, Any]]:
    institution_id = candidate.get("institution_id", current["institution_id"])
    institution_ids = {current["institution_id"], institution_id}
    institutions = {
        item["institution_id"]: item
        for item in database.institutions.find(
            {"institution_id": {"$in": list(institution_ids)}}, {"_id": 0}
        )
    }
    institution = institutions.get(institution_id)
    hash_value = None
    if "apaar_identifier" in changes:
        hash_value = identifier_hash(changes["apaar_identifier"]) if changes["apaar_identifier"] else None
    elif current.get("apaar_hash"):
        hash_value = current["apaar_hash"]
    conflicts = []
    if hash_value:
        conflicts = list(
            database.students.find(
                {"apaar_hash": hash_value, "record_id": {"$ne": current["record_id"]}},
                {"_id": 0, "record_id": 1, "student_id": 1, "institution_id": 1},
            )
        )
    now = datetime.now(UTC)
    active_tokens = list(
        database.verification_tokens.find(
            {
                "record_id": current["record_id"],
                "revoked_at": None,
                "stale": {"$ne": True},
                "expires_at": {"$gt": now},
            },
            {"_id": 0, "token_id": 1},
        )
    )
    analysis_current = dict(current)
    analysis_candidate = dict(candidate)
    if "apaar_identifier" in changes and hash_value == current.get("apaar_hash"):
        analysis_current["apaar_identifier"] = changes["apaar_identifier"]
    return [
        finding.model_dump(mode="json")
        for finding in detect_impacts(
            analysis_current,
            analysis_candidate,
            institution=institution,
            institutions=institutions,
            linked_records=_linked_records(database, current),
            identifier_conflicts=conflicts,
            active_tokens=active_tokens,
            enrolments=_enrolments(database),
        )
    ]


def create_student(
    database: Any, payload: StudentCreate, actor: dict[str, Any], *, session: Any = None
) -> dict[str, Any]:
    values = payload.model_dump(mode="python")
    if actor["role"] == "institution_admin" and values["institution_id"] != actor.get("institution_id"):
        raise HTTPException(status_code=403, detail="Cannot create records for another institution")
    institution = database.institutions.find_one(
        {"institution_id": values["institution_id"]}, {"programmes": 1, "_id": 0}
    )
    if institution is None:
        raise HTTPException(status_code=422, detail="Institution is not configured")
    if not any(programme.get("name") == values["programme"] for programme in institution.get("programmes", [])):
        raise HTTPException(status_code=422, detail="Programme is not configured for this institution")
    values = _database_values(values)
    now = datetime.now(UTC)
    record_id = str(uuid4())
    document = {
        **values,
        "record_id": record_id,
        "student_id_normalized": payload.student_id.strip().casefold(),
        "version": 1,
        "created_at": now,
        "updated_at": now,
    }
    def persist(active_session: Any) -> None:
        database.students.insert_one(document, session=active_session)
        database.record_versions.insert_one(
            {
                "record_id": record_id,
                "previous_values": None,
                "new_values": safe_record_values(document),
                "changed_fields": sorted(payload.model_fields_set),
                "actor_id": actor["user_id"],
                "reason": "Initial record creation",
                "timestamp": now,
                "previous_version": None,
                "new_version": 1,
                "assessment_id": None,
            },
            session=active_session,
        )
        database.audit_logs.insert_one(
            audit_event(actor, "student.create", target_record_id=record_id,
                        institution_id=payload.institution_id, changed_fields=sorted(payload.model_fields_set)),
            session=active_session,
        )

    try:
        if session is None:
            with database.client.start_session() as active_session:
                with active_session.start_transaction():
                    persist(active_session)
        else:
            persist(session)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Student ID or APAAR identifier already exists") from exc
    except (PyMongoError, NotImplementedError, AttributeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Student creation was not committed: MongoDB transaction support is required",
        ) from exc
    return public_student(document)


def list_students(database: Any, query: dict[str, Any], *, skip: int, limit: int) -> list[dict[str, Any]]:
    return [public_student(item) for item in database.students.find(query, {"_id": 0}).sort("student_id", 1).skip(skip).limit(limit)]


def get_student(database: Any, record_id: str) -> dict[str, Any]:
    record = database.students.find_one({"record_id": record_id})
    if record is None:
        raise HTTPException(status_code=404, detail="Student record not found")
    return record


def preview_correction(
    database: Any,
    record_id: str,
    changes: dict[str, Any],
    expected_version: int,
    actor: dict[str, Any],
) -> dict[str, Any]:
    current = get_student(database, record_id)
    if actor["role"] == "institution_admin" and current["institution_id"] != actor.get("institution_id"):
        raise HTTPException(status_code=403, detail="Institution access denied")
    if current["version"] != expected_version:
        raise HTTPException(status_code=409, detail="Record changed since it was loaded; refresh before previewing")
    if "institution_id" in changes and actor["role"] == "institution_admin" and changes["institution_id"] != actor["institution_id"]:
        raise HTTPException(status_code=403, detail="Cannot move records outside your institution")
    if "student_id" in changes and changes["student_id"] != current["student_id"]:
        raise HTTPException(status_code=422, detail="Student ID is immutable; use the APAAR identifier field for identifier corrections")
    candidate = _validate_merged(current, changes)
    findings = _analyze(database, current, candidate, changes)
    assessment = {
        "assessment_id": str(uuid4()),
        "record_id": current["record_id"],
        "institution_id": candidate["institution_id"],
        "triggering_version": expected_version + 1,
        "changed_fields": list(changes),
        "findings": findings,
        "status": "preview",
        "created_at": datetime.now(UTC),
    }
    return {
        "assessment": assessment,
        "proposed_changes": {
            key: ("[REDACTED]" if key == "apaar_identifier" else value.isoformat() if hasattr(value, "isoformat") else value)
            for key, value in changes.items()
        },
        "checklist": build_review_tasks(assessment),
    }


def apply_correction(
    database: Any,
    record_id: str,
    changes: dict[str, Any],
    expected_version: int,
    reason: str,
    actor: dict[str, Any],
) -> dict[str, Any]:
    preview = preview_correction(database, record_id, changes, expected_version, actor)
    current = get_student(database, record_id)
    new_version = expected_version + 1
    assessment = preview["assessment"]
    assessment["status"] = "applied"
    now = datetime.now(UTC)
    stored_changes = _database_values(changes)
    new_values = safe_record_values({**current, **stored_changes, "version": new_version, "updated_at": now})
    history = {
        "record_id": current["record_id"],
        "previous_values": safe_record_values(current),
        "new_values": new_values,
        "changed_fields": list(changes),
        "actor_id": actor["user_id"],
        "reason": reason,
        "timestamp": now,
        "previous_version": expected_version,
        "new_version": new_version,
        "assessment_id": assessment["assessment_id"],
    }
    tasks = build_review_tasks(assessment)
    try:
        with database.client.start_session() as session:
            with session.start_transaction():
                result = database.students.update_one(
                    {"record_id": current["record_id"], "version": expected_version},
                    {"$set": {**stored_changes, "version": new_version, "updated_at": now}},
                    session=session,
                )
                if result.modified_count != 1:
                    raise HTTPException(status_code=409, detail="Record changed since preview; create a new preview")
                database.record_versions.insert_one(history, session=session)
                database.impact_assessments.insert_one(assessment, session=session)
                if tasks:
                    database.review_tasks.insert_many(tasks, session=session)
                if set(changes) & RELEVANT_CREDENTIAL_FIELDS:
                    database.verification_tokens.update_many(
                        {"record_id": current["record_id"], "revoked_at": None, "expires_at": {"$gt": now}},
                        {"$set": {"stale": True, "stale_at": now}},
                        session=session,
                    )
                database.audit_logs.insert_one(
                    audit_event(
                        actor, "student.correction.apply", target_record_id=current["record_id"],
                        institution_id=current["institution_id"], changed_fields=list(changes), reason=reason,
                    ),
                    session=session,
                )
    except HTTPException:
        raise
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="APAAR identifier already belongs to another student") from exc
    except (PyMongoError, NotImplementedError, AttributeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Correction was not applied: MongoDB transactions are required and must be enabled",
        ) from exc
    updated = get_student(database, record_id)
    return {
        "student": public_student(updated),
        "assessment": assessment,
        "review_tasks": tasks,
    }


def archive_student(database: Any, record_id: str, actor: dict[str, Any], expected_version: int) -> dict[str, Any]:
    return apply_correction(
        database, record_id, {"status": "archived"}, expected_version,
        "Record archived by authorized user", actor,
    )
