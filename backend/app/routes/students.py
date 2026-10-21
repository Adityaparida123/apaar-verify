import csv
import io
import re
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from pymongo.errors import PyMongoError

from app.config import get_settings
from app.dependencies import database_dependency, require_institution_access, require_roles
from app.models.common import Role
from app.models.impact import CorrectionApply, CorrectionPreview
from app.models.student import StudentCreate, StudentPatch
from app.services.student_service import (
    archive_student,
    create_student,
    get_student,
    list_students,
    preview_correction,
    public_student,
    apply_correction,
)
from app.security import identifier_hash

router = APIRouter(prefix="/api/v1/students", tags=["students"])
WRITE_ROLES = (Role.institution_admin, Role.aicte_official)
CSV_COLUMNS = [
    "student_id", "apaar_identifier", "full_name", "institution_id", "programme",
    "academic_year", "admission_date", "admission_category", "nri_status", "oci_status",
    "foreign_national_status", "supernumerary_seat_status",
]


@router.get("/csv-template")
def csv_template(_: dict[str, Any] = Depends(require_roles(*WRITE_ROLES))) -> StreamingResponse:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_COLUMNS)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="student-template.csv"'})


@router.get("")
def students(
    q: str | None = None,
    institution_id: str | None = None,
    programme: str | None = None,
    academic_year: str | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(Role.institution_admin, Role.aicte_official)),
) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if user["role"] == Role.institution_admin.value:
        query["institution_id"] = user["institution_id"]
    elif institution_id:
        query["institution_id"] = institution_id
    for key, value in (("programme", programme), ("academic_year", academic_year), ("status", status)):
        if value:
            query[key] = value
    if q:
        escaped = re.escape(q)
        query["$or"] = [{"student_id": {"$regex": escaped, "$options": "i"}}, {"full_name": {"$regex": escaped, "$options": "i"}}]
    total = database.students.count_documents(query)
    return {"items": list_students(database, query, skip=(page - 1) * page_size, limit=page_size),
            "page": page, "page_size": page_size, "total": total}


@router.post("", status_code=201)
def create(
    payload: StudentCreate,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*WRITE_ROLES)),
) -> dict[str, Any]:
    return create_student(database, payload, user)


@router.get("/{record_id}")
def retrieve(
    record_id: str,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(Role.institution_admin, Role.aicte_official)),
) -> dict[str, Any]:
    record = get_student(database, record_id)
    require_institution_access(user, record["institution_id"])
    return public_student(record)


@router.patch("/{record_id}")
def update(
    record_id: str,
    payload: StudentPatch,
    if_match: str | None = Header(default=None, alias="If-Match"),
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*WRITE_ROLES)),
) -> dict[str, Any]:
    if if_match is None or not if_match.strip('"').isdigit():
        raise HTTPException(status_code=428, detail='If-Match header with the observed record version is required')
    try:
        changes = payload.changes()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    result = apply_correction(database, record_id, changes, int(if_match.strip('"')), "Updated through student PATCH", user)
    return result["student"]


@router.delete("/{record_id}")
def delete(
    record_id: str,
    if_match: str | None = Header(default=None, alias="If-Match"),
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*WRITE_ROLES)),
) -> dict[str, Any]:
    if if_match is None or not if_match.strip('"').isdigit():
        raise HTTPException(status_code=428, detail='If-Match header with the observed record version is required')
    return archive_student(database, record_id, user, int(if_match.strip('"')))


@router.post("/{record_id}/correction-preview")
def correction_preview(
    record_id: str,
    body: CorrectionPreview,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*WRITE_ROLES)),
) -> dict[str, Any]:
    try:
        payload = StudentPatch.model_validate(body.changes)
        changes = payload.changes()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return preview_correction(database, record_id, changes, body.expected_version, user)


@router.post("/{record_id}/corrections")
def correction_apply(
    record_id: str,
    body: CorrectionApply,
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*WRITE_ROLES)),
) -> dict[str, Any]:
    try:
        payload = StudentPatch.model_validate(body.changes)
        changes = payload.changes()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return apply_correction(database, record_id, changes, body.expected_version, body.reason, user)


@router.post("/upload-csv", status_code=200)
async def upload_csv(
    file: UploadFile = File(...),
    database: Any = Depends(database_dependency),
    user: dict[str, Any] = Depends(require_roles(*WRITE_ROLES)),
) -> dict[str, Any]:
    settings = get_settings()
    if file.content_type not in {"text/csv", "application/vnd.ms-excel", "application/csv"}:
        raise HTTPException(status_code=415, detail="Upload a CSV file")
    raw = await file.read(settings.max_csv_file_bytes + 1)
    if len(raw) > settings.max_csv_file_bytes:
        raise HTTPException(status_code=413, detail="CSV file exceeds the configured size limit")
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        if reader.fieldnames != CSV_COLUMNS:
            raise HTTPException(status_code=422, detail={"message": "CSV columns do not match the template", "required_columns": CSV_COLUMNS})
        rows = list(reader)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="CSV must be UTF-8 encoded") from exc
    if len(rows) > settings.max_csv_rows:
        raise HTTPException(status_code=422, detail=f"CSV may contain at most {settings.max_csv_rows} rows")
    accepted: list[tuple[int, StudentCreate]] = []
    errors: list[dict[str, Any]] = []
    seen_student_ids: set[tuple[str, str]] = set()
    seen_apaar: set[str] = set()
    for line_number, row in enumerate(rows, start=2):
        try:
            if user["role"] == Role.institution_admin.value and row["institution_id"] != user["institution_id"]:
                raise ValueError("institution_id is outside your authorized scope")
            values = dict(row)
            for key in ("nri_status", "oci_status", "foreign_national_status", "supernumerary_seat_status"):
                raw_bool = values[key].strip().casefold()
                if raw_bool not in {"true", "false"}:
                    raise ValueError(f"{key} must be true or false")
                values[key] = raw_bool == "true"
            values["admission_date"] = date.fromisoformat(values["admission_date"])
            if not values["apaar_identifier"]:
                values["apaar_identifier"] = None
            payload = StudentCreate.model_validate(values)
            identity = (payload.institution_id, payload.student_id.casefold())
            if identity in seen_student_ids:
                raise ValueError("duplicate student_id within this file")
            seen_student_ids.add(identity)
            if payload.apaar_identifier:
                digest = identifier_hash(payload.apaar_identifier)
                if digest in seen_apaar:
                    raise ValueError("duplicate APAAR identifier within this file")
                seen_apaar.add(digest)
            accepted.append((line_number, payload))
        except ValidationError as exc:
            errors.append(
                {
                    "row": line_number,
                    "error": [
                        {"field": ".".join(str(part) for part in item["loc"]), "message": item["msg"]}
                        for item in exc.errors(include_input=False)
                    ],
                }
            )
        except ValueError as exc:
            errors.append({"row": line_number, "error": str(exc)})
    for line_number, payload in accepted:
        institution = database.institutions.find_one(
            {"institution_id": payload.institution_id}, {"programmes": 1, "_id": 0}
        )
        if institution is None or not any(
            item.get("name") == payload.programme for item in institution.get("programmes", [])
        ):
            errors.append({"row": line_number, "error": "institution or programme is not configured"})
            continue
        student_filter = {"institution_id": payload.institution_id, "student_id_normalized": payload.student_id.casefold()}
        conflict = database.students.find_one(student_filter)
        apaar_conflict = None
        if payload.apaar_identifier:
            apaar_conflict = database.students.find_one({"apaar_hash": identifier_hash(payload.apaar_identifier)})
        if conflict or apaar_conflict:
            errors.append({"row": line_number, "error": "student ID or APAAR identifier already exists"})
    if errors:
        return {
            "status": "rejected",
            "accepted_rows": 0,
            "rejected_rows": len(rows),
            "errors": errors,
            "warnings": [],
        }
    try:
        with database.client.start_session() as session:
            with session.start_transaction():
                inserted = [create_student(database, payload, user, session=session) for _, payload in accepted]
    except HTTPException:
        raise
    except (PyMongoError, NotImplementedError, AttributeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Import was not committed: transaction support is required; no partial import was reported",
        ) from exc
    return {"status": "complete", "accepted_rows": len(inserted), "rejected_rows": 0, "errors": [], "warnings": []}
