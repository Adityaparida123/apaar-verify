from datetime import UTC, datetime, timedelta
import sys

import mongomock
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

from app.config import get_settings
from app.database import ensure_indexes
from app.main import create_app
from app.models.student import StudentCreate, StudentPatch
from app.security import create_access_token, hash_password, identifier_hash, verification_token_hash
from app.services.audit_service import audit_event
from app.services.student_service import apply_correction, create_student, preview_correction


class _NoopContext:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class _Session:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def start_transaction(self):
        return _NoopContext()


class _Client:
    def start_session(self):
        return _Session()


class _Collection:
    def __init__(self, collection):
        self._collection = collection

    def __getattr__(self, name):
        value = getattr(self._collection, name)
        if not callable(value):
            return value

        def call(*args, **kwargs):
            kwargs.pop("session", None)
            return value(*args, **kwargs)

        return call


class _TransactionalDatabase:
    def __init__(self, database):
        self._database = database
        self.client = _Client()

    def __getattr__(self, name):
        return _Collection(getattr(self._database, name))


@pytest.fixture
def database(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-only-secret-that-is-not-used-outside-tests")
    get_settings.cache_clear()
    db = mongomock.MongoClient(tz_aware=True).get_database("test_apaar")
    yield db
    get_settings.cache_clear()


def make_student(**overrides):
    values = {
        "student_id": "S-100",
        "apaar_identifier": None,
        "full_name": "Test Student",
        "institution_id": "I-1",
        "programme": "Computing",
        "academic_year": "2025-26",
        "admission_date": "2025-08-01",
        "admission_category": "regular",
        "nri_status": False,
        "oci_status": False,
        "foreign_national_status": False,
        "supernumerary_seat_status": False,
    }
    values.update(overrides)
    return StudentCreate.model_validate(values)


def seed_current_record(database):
    database.students.insert_one(
        {
            "student_id": "S-100",
            "record_id": "record-100",
            "institution_id": "I-1",
            "programme": "Computing",
            "academic_year": "2025-26",
            "admission_date": datetime(2025, 8, 1, tzinfo=UTC),
            "admission_category": "regular",
            "nri_status": False,
            "oci_status": False,
            "foreign_national_status": False,
            "supernumerary_seat_status": False,
            "full_name": "Test Student",
            "status": "active",
            "version": 2,
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
    )
    database.institutions.insert_one(
        {
            "institution_id": "I-1",
            "programmes": [{"name": "Computing", "approved_intake": 10}],
        }
    )


def test_student_model_rejects_invalid_academic_year() -> None:
    with pytest.raises(ValueError):
        make_student(academic_year="2025-27")


def test_student_model_rejects_invalid_apaar_identifier() -> None:
    with pytest.raises(ValueError):
        make_student(apaar_identifier="not-a-number")


def test_correction_preview_does_not_mutate_database(database) -> None:
    seed_current_record(database)
    actor = {"user_id": "u-1", "role": "institution_admin", "institution_id": "I-1"}
    before = database.students.find_one({"student_id": "S-100"})

    result = preview_correction(
        database, "record-100", StudentPatch(full_name="Updated Student").changes(), 2, actor
    )

    after = database.students.find_one({"student_id": "S-100"})
    assert result["assessment"]["status"] == "preview"
    assert result["proposed_changes"] == {"full_name": "Updated Student"}
    assert after == before
    assert database.impact_assessments.count_documents({}) == 0
    assert database.review_tasks.count_documents({}) == 0


def test_correction_preview_api_is_read_only(database) -> None:
    seed_current_record(database)
    user = {
        "user_id": "admin-1",
        "email": "admin@example.test",
        "email_normalized": "admin@example.test",
        "password_hash": hash_password("test-password"),
        "role": "institution_admin",
        "institution_id": "I-1",
        "active": True,
    }
    database.users.insert_one(user)
    app = create_app(database)
    token, _ = create_access_token(user)

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/students/record-100/correction-preview",
            headers={"Authorization": f"Bearer {token}"},
            json={"changes": {"full_name": "Updated Student"}, "expected_version": 2},
        )

    assert response.status_code == 200
    assert response.json()["assessment"]["status"] == "preview"
    assert database.students.find_one({"record_id": "record-100"})["full_name"] == "Test Student"
    assert database.impact_assessments.count_documents({}) == 0


def test_stale_preview_is_rejected(database) -> None:
    seed_current_record(database)
    actor = {"user_id": "u-1", "role": "institution_admin", "institution_id": "I-1"}

    with pytest.raises(HTTPException) as exc:
        preview_correction(database, "record-100", {"full_name": "Changed"}, 1, actor)

    assert exc.value.status_code == 409


def test_student_creation_fails_without_transaction_support(database) -> None:
    actor = {"user_id": "u-1", "role": "institution_admin", "institution_id": "I-1"}
    database.institutions.insert_one(
        {"institution_id": "I-1", "programmes": [{"name": "Computing", "approved_intake": 10}]}
    )

    with pytest.raises(HTTPException) as exc:
        create_student(database, make_student(), actor)

    assert exc.value.status_code == 503
    assert database.students.count_documents({}) == 0
    assert database.record_versions.count_documents({}) == 0
    assert database.audit_logs.count_documents({}) == 0


def test_student_creation_persists_record_version_and_audit(database) -> None:
    database.institutions.insert_one(
        {"institution_id": "I-1", "programmes": [{"name": "Computing", "approved_intake": 10}]}
    )
    actor = {"user_id": "admin-1", "role": "institution_admin", "institution_id": "I-1"}

    created = create_student(_TransactionalDatabase(database), make_student(), actor)

    stored = database.students.find_one({"record_id": created["record_id"]})
    history = database.record_versions.find_one({"record_id": created["record_id"]})
    assert stored is not None
    assert stored["version"] == 1
    assert stored["admission_date"] == datetime(2025, 8, 1, tzinfo=UTC)
    assert created["admission_date"].isoformat() == "2025-08-01"
    assert history["new_version"] == 1
    assert database.audit_logs.count_documents(
        {"action": "student.create", "target_record_id": created["record_id"]}
    ) == 1


def test_successful_correction_preserves_history_and_linked_records(database) -> None:
    seed_current_record(database)
    database.linked_records.insert_one(
        {
            "record_id": "linked-1",
            "student_id": "S-100",
            "institution_id": "I-1",
            "academic_year": "2025-26",
        }
    )
    database.verification_tokens.insert_one(
        {
            "token_id": "token-1",
            "record_id": "record-100",
            "token_hash": "token-hash",
            "issued_at": datetime.now(UTC),
            "expires_at": datetime.now(UTC) + timedelta(days=1),
            "revoked_at": None,
            "stale": False,
        }
    )
    actor = {"user_id": "admin-1", "role": "institution_admin", "institution_id": "I-1"}

    result = apply_correction(
        _TransactionalDatabase(database),
        "record-100",
        {"academic_year": "2026-27"},
        2,
        "Corrected admission year",
        actor,
    )

    assert result["student"]["version"] == 3
    assert database.students.find_one({"record_id": "record-100"})["academic_year"] == "2026-27"
    assert database.linked_records.find_one({"record_id": "linked-1"})["academic_year"] == "2025-26"
    assert database.record_versions.find_one({"record_id": "record-100", "new_version": 3})[
        "previous_version"
    ] == 2
    assessment = database.impact_assessments.find_one(
        {"assessment_id": result["assessment"]["assessment_id"]}
    )
    assert assessment["status"] == "applied"
    assert any(finding["rule_id"] == "academic_year.reconciliation" for finding in assessment["findings"])
    assert database.review_tasks.count_documents({"assessment_id": assessment["assessment_id"]}) >= 1
    assert database.audit_logs.count_documents(
        {"action": "student.correction.apply", "target_record_id": "record-100"}
    ) == 1
    assert database.verification_tokens.find_one({"token_id": "token-1"})["stale"]


def test_correction_apply_enforces_institution_scope_and_version(database) -> None:
    seed_current_record(database)
    scoped_users = [
        {
            "user_id": "admin-other",
            "email": "other@example.test",
            "email_normalized": "other@example.test",
            "password_hash": hash_password("test-password"),
            "role": "institution_admin",
            "institution_id": "I-2",
            "active": True,
        },
        {
            "user_id": "admin-home",
            "email": "home@example.test",
            "email_normalized": "home@example.test",
            "password_hash": hash_password("test-password"),
            "role": "institution_admin",
            "institution_id": "I-1",
            "active": True,
        },
    ]
    database.users.insert_many(scoped_users)
    tokens = [create_access_token(user)[0] for user in scoped_users]
    app = create_app(_TransactionalDatabase(database))

    with TestClient(app) as client:
        cross_institution = client.post(
            "/api/v1/students/record-100/corrections",
            headers={"Authorization": f"Bearer {tokens[0]}"},
            json={
                "changes": {"full_name": "Unauthorized"},
                "expected_version": 2,
                "reason": "Attempted change",
            },
        )
        stale_version = client.post(
            "/api/v1/students/record-100/corrections",
            headers={"Authorization": f"Bearer {tokens[1]}"},
            json={
                "changes": {"full_name": "Stale update"},
                "expected_version": 1,
                "reason": "Stale preview",
            },
        )

    assert cross_institution.status_code == 403
    assert stale_version.status_code == 409
    assert database.students.find_one({"record_id": "record-100"})["full_name"] == "Test Student"
    assert database.record_versions.count_documents({"record_id": "record-100"}) == 0
    assert database.audit_logs.count_documents({"action": "student.correction.apply"}) == 0


def test_student_indexes_enforce_internal_id_and_optional_apaar_uniqueness(database) -> None:
    ensure_indexes(database)
    for student_id in ("A-1", "A-2"):
        database.students.insert_one(
            {"record_id": student_id, "student_id": student_id, "institution_id": "I-1",
             "student_id_normalized": student_id.casefold()}
        )
    database.students.insert_one(
        {"record_id": "A-3", "student_id": "A-3", "institution_id": "I-1",
         "student_id_normalized": "a-3", "apaar_hash": identifier_hash("510000000001")}
    )
    database.students.insert_one(
        {"record_id": "A-4", "student_id": "A-4", "institution_id": "I-1",
         "student_id_normalized": "a-4"}
    )

    with pytest.raises(DuplicateKeyError):
        database.students.insert_one(
            {"record_id": "A-5", "student_id": "A-5", "institution_id": "I-2",
             "student_id_normalized": "a-5", "apaar_hash": identifier_hash("510000000001")}
        )

    assert database.students.count_documents({}) == 4


def test_reapplying_same_apaar_identifier_does_not_mark_credentials_stale(database) -> None:
    seed_current_record(database)
    identifier = "510000000001"
    database.students.update_one(
        {"record_id": "record-100"}, {"$set": {"apaar_hash": identifier_hash(identifier)}}
    )
    database.verification_tokens.insert_one(
        {
            "token_id": "token-1",
            "record_id": "record-100",
            "token_hash": "token-hash",
            "issued_at": datetime.now(UTC),
            "expires_at": datetime.now(UTC) + timedelta(days=1),
            "revoked_at": None,
            "stale": False,
        }
    )
    actor = {"user_id": "admin-1", "role": "institution_admin", "institution_id": "I-1"}

    result = preview_correction(
        database,
        "record-100",
        {"apaar_identifier": identifier},
        2,
        actor,
    )

    assert not any(
        finding["rule_id"] == "verification.credentials_stale"
        for finding in result["assessment"]["findings"]
    )


def test_verification_token_revoke_prevents_future_verification(database) -> None:
    seed_current_record(database)
    user = {
        "user_id": "admin-1",
        "email": "admin@example.test",
        "email_normalized": "admin@example.test",
        "password_hash": hash_password("test-password"),
        "role": "institution_admin",
        "institution_id": "I-1",
        "active": True,
    }
    raw_token = "token-to-revoke"
    database.users.insert_one(user)
    database.verification_tokens.insert_one(
        {
            "token_id": "token-1",
            "record_id": "record-100",
            "token_hash": verification_token_hash(raw_token),
            "issued_at": datetime.now(UTC),
            "expires_at": datetime.now(UTC) + timedelta(days=1),
            "revoked_at": None,
            "stale": False,
        }
    )
    app = create_app(_TransactionalDatabase(database))
    bearer, _ = create_access_token(user)

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/verification-tokens/token-1/revoke",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        verification = client.get(f"/api/v1/verify/{raw_token}")

    assert response.status_code == 200
    assert verification.status_code == 410
    assert database.audit_logs.count_documents({"action": "verification.revoke"}) == 1


def test_demo_seed_requires_demo_mode(monkeypatch) -> None:
    monkeypatch.setenv("MONGODB_URI", "mongodb://localhost:27017")
    monkeypatch.setenv("JWT_SECRET", "test-only-secret-that-is-not-used-outside-tests")
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "a-long-test-password")
    monkeypatch.setenv("DEMO_OFFICIAL_PASSWORD", "a-long-test-password")
    monkeypatch.setenv("DEMO_VERIFIER_PASSWORD", "a-long-test-password")
    get_settings.cache_clear()
    monkeypatch.setattr(sys, "argv", ["seed_demo"])

    try:
        with pytest.raises(SystemExit):
            from scripts.seed_demo import main

            main()
    finally:
        get_settings.cache_clear()


def test_demo_reset_requires_demo_or_test_database_name(monkeypatch) -> None:
    monkeypatch.setenv("MONGODB_URI", "mongodb://localhost:27017")
    monkeypatch.setenv("MONGODB_DATABASE", "production_records")
    monkeypatch.setenv("JWT_SECRET", "test-only-secret-that-is-not-used-outside-tests")
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "a-long-test-password")
    monkeypatch.setenv("DEMO_OFFICIAL_PASSWORD", "a-long-test-password")
    monkeypatch.setenv("DEMO_VERIFIER_PASSWORD", "a-long-test-password")
    get_settings.cache_clear()
    monkeypatch.setattr(sys, "argv", ["seed_demo", "--reset"])

    try:
        with pytest.raises(SystemExit):
            from scripts.seed_demo import main

            main()
    finally:
        get_settings.cache_clear()


def test_audit_reasons_redact_identifiers_and_opaque_tokens() -> None:
    actor = {"user_id": "admin-1", "role": "institution_admin"}
    event = audit_event(
        actor,
        "test",
        reason="APAAR 510000000001 token " + "A" * 43,
    )

    assert "510000000001" not in event["reason"]
    assert "A" * 43 not in event["reason"]
    assert "[REDACTED IDENTIFIER]" in event["reason"]
    assert "[REDACTED TOKEN]" in event["reason"]


def test_api_health_and_verifier_cannot_list_student_records(database) -> None:
    database.users.insert_one(
        {
            "user_id": "verify-1",
            "email": "verifier@example.test",
            "email_normalized": "verifier@example.test",
            "password_hash": hash_password("test-password"),
            "role": "verifier",
            "institution_id": None,
            "active": True,
        }
    )
    app = create_app(database)
    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        assert client.get("/health").json()["database"] == "connected"
        token, _ = create_access_token(database.users.find_one({"user_id": "verify-1"}))
        response = client.get("/api/v1/students", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403


def test_institution_admin_cannot_read_another_institutions_record(database) -> None:
    seed_current_record(database)
    user = {
        "user_id": "admin-2",
        "email": "admin2@example.test",
        "email_normalized": "admin2@example.test",
        "password_hash": hash_password("test-password"),
        "role": "institution_admin",
        "institution_id": "I-2",
        "active": True,
    }
    database.users.insert_one(user)
    app = create_app(database)
    token, _ = create_access_token(user)

    with TestClient(app) as client:
        response = client.get(
            "/api/v1/students/record-100",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 403


def test_public_verification_only_returns_allowlisted_claims(database) -> None:
    raw_token = "a-long-random-test-token"
    database.verification_tokens.insert_one(
        {
            "token_id": "token-1",
            "token_hash": verification_token_hash(raw_token),
            "record_id": "record-100",
            "issued_at": datetime.now(UTC),
            "expires_at": datetime.now(UTC) + timedelta(days=1),
            "revoked_at": None,
            "stale": False,
        }
    )
    seed_current_record(database)
    database.students.update_one(
        {"student_id": "S-100"}, {"$set": {"apaar_hash": "private-hash", "full_name": "Private Name"}}
    )
    app = create_app(database)

    with TestClient(app) as client:
        response = client.get(f"/api/v1/verify/{raw_token}")

    assert response.status_code == 200
    data = response.json()
    assert data["valid"]
    assert set(data["claims"]) <= {"status", "institution_id", "programme", "academic_year", "issued_at"}
    assert "private-hash" not in response.text
    assert "Private Name" not in response.text


def test_expired_verification_token_is_rejected(database) -> None:
    raw_token = "expired-test-token"
    database.verification_tokens.insert_one(
        {
            "token_id": "expired-token",
            "token_hash": verification_token_hash(raw_token),
            "record_id": "record-100",
            "issued_at": datetime.now(UTC) - timedelta(days=2),
            "expires_at": datetime.now(UTC) - timedelta(days=1),
            "revoked_at": None,
            "stale": False,
        }
    )
    app = create_app(database)

    with TestClient(app) as client:
        response = client.get(f"/api/v1/verify/{raw_token}")

    assert response.status_code in {404, 410}


def test_review_task_resolution_requires_outcome(database) -> None:
    user = {
        "user_id": "admin-1",
        "email": "admin@example.test",
        "email_normalized": "admin@example.test",
        "password_hash": hash_password("test-password"),
        "role": "institution_admin",
        "institution_id": "I-1",
        "active": True,
    }
    database.users.insert_one(user)
    database.review_tasks.insert_one(
        {
            "task_id": "task-1",
            "assessment_id": "assessment-1",
            "institution_id": "I-1",
            "title": "Check source record",
            "status": "open",
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
    )
    app = create_app(database)
    token, _ = create_access_token(user)

    with TestClient(app) as client:
        response = client.patch(
            "/api/v1/review-tasks/task-1",
            headers={"Authorization": f"Bearer {token}"},
            json={"status": "resolved", "review_note": "Reviewed the source", "outcome": None},
        )

    assert response.status_code == 422
    assert database.review_tasks.find_one({"task_id": "task-1"})["status"] == "open"


def test_csv_invalid_row_is_rejected_without_inserting_records(database) -> None:
    user = {
        "user_id": "admin-1",
        "email": "admin@example.test",
        "email_normalized": "admin@example.test",
        "password_hash": hash_password("test-password"),
        "role": "institution_admin",
        "institution_id": "I-1",
        "active": True,
    }
    database.users.insert_one(user)
    app = create_app(database)
    token, _ = create_access_token(user)
    csv_data = (
        "student_id,apaar_identifier,full_name,institution_id,programme,academic_year,admission_date,"
        "admission_category,nri_status,oci_status,foreign_national_status,supernumerary_seat_status\n"
        "S-1,,Name,I-1,Computing,2025-27,2025-08-01,regular,false,false,false,false\n"
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/students/upload-csv",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("students.csv", csv_data, "text/csv")},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert response.json()["rejected_rows"] == 1
    assert database.students.count_documents({}) == 0


def test_health_distinguishes_missing_database_configuration(monkeypatch) -> None:
    from app.database import get_client
    from app.config import Settings

    class EmptySettings(Settings):
        mongodb_uri: str | None = None

    monkeypatch.setattr("app.database.get_settings", lambda: EmptySettings(mongodb_uri=None))
    get_client.cache_clear()
    app = create_app()

    with TestClient(app) as client:
        assert client.get("/health").json() == {"api": "available", "database": "unavailable"}
        assert client.get("/ready").status_code == 503
