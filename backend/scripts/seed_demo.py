import argparse
from datetime import UTC, date, datetime
from uuid import uuid4

from pymongo import MongoClient

from app.config import get_settings
from app.security import hash_password, identifier_hash, random_verification_token, verification_token_hash


def main() -> None:
    parser = argparse.ArgumentParser(description="Create fictional APAAR Verify demonstration data.")
    parser.add_argument("--reset", action="store_true", help="Delete data in the configured demo database before seeding.")
    args = parser.parse_args()
    settings = get_settings()
    if not settings.demo_mode:
        parser.error("Set DEMO_MODE=true before seeding a demo database")
    if args.reset and not any(
        marker in settings.mongodb_database.casefold() for marker in ("demo", "test")
    ):
        parser.error("--reset requires MONGODB_DATABASE to contain 'demo' or 'test'")
    if not settings.mongodb_uri:
        parser.error("Set MONGODB_URI before running the seed script")
    if not settings.jwt_secret:
        parser.error("Set JWT_SECRET before running the seed script")
    passwords = {
        "admin": settings.demo_admin_password,
        "official": settings.demo_official_password,
        "verifier": settings.demo_verifier_password,
    }
    if not all(passwords.values()):
        parser.error("Set DEMO_ADMIN_PASSWORD, DEMO_OFFICIAL_PASSWORD, and DEMO_VERIFIER_PASSWORD")
    if any(len(password) < 12 for password in passwords.values() if password is not None):
        parser.error("Demo passwords must each contain at least 12 characters")

    client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
    database = client[settings.mongodb_database]
    if args.reset:
        for collection in (
            "students", "institutions", "record_versions", "impact_assessments",
            "review_tasks", "audit_logs", "users", "verification_tokens", "linked_records",
        ):
            database[collection].delete_many({})

    now = datetime.now(UTC)
    institution = {
        "institution_id": "DEMO-ENG-01",
        "name": "Example Institute of Technology",
        "approval_reference": "DEMO-APPROVAL-2026-001",
        "programmes": [
            {
                "name": "Computer Engineering",
                "approved_intake": 2,
                "academic_year_intake": {"2025-26": 2, "2026-27": 2},
                "supernumerary_limit": 1,
            },
            {
                "name": "Civil Engineering",
                "approved_intake": 5,
                "academic_year_intake": {"2025-26": 5},
                "supernumerary_limit": 1,
            },
        ],
        "created_at": now,
        "updated_at": now,
    }
    database.institutions.update_one(
        {"institution_id": institution["institution_id"]}, {"$set": institution}, upsert=True
    )
    demo_students = [
        ("DEMO-STU-001", "Aarav Example", "Computer Engineering", "2025-26", "510000000001"),
        ("DEMO-STU-002", "Mira Sample", "Computer Engineering", "2025-26", "510000000002"),
        ("DEMO-STU-003", "Dev Sample", "Civil Engineering", "2025-26", "510000000003"),
    ]
    for student_id, full_name, programme, academic_year, apaar in demo_students:
        document = {
            "student_id": student_id,
            "student_id_normalized": student_id.casefold(),
            "apaar_hash": identifier_hash(apaar),
            "full_name": full_name,
            "institution_id": institution["institution_id"],
            "programme": programme,
            "academic_year": academic_year,
            "admission_date": date(2025, 8, 1),
            "admission_category": "regular",
            "nri_status": False,
            "oci_status": False,
            "foreign_national_status": False,
            "supernumerary_seat_status": False,
            "status": "active",
            "record_id": str(uuid4()),
            "version": 1,
            "created_at": now,
            "updated_at": now,
        }
        result = database.students.update_one(
            {"student_id": student_id}, {"$setOnInsert": document}, upsert=True
        )
        if result.upserted_id is not None:
            record_values = {
                key: value for key, value in document.items()
                if key not in {"_id", "apaar_hash", "student_id_normalized"}
            }
            database.record_versions.insert_one(
                {
                    "record_id": document["record_id"],
                    "previous_values": None,
                    "new_values": record_values,
                    "changed_fields": [key for key in record_values if key not in {"record_id", "version", "created_at", "updated_at"}],
                    "actor_id": "system-seed",
                    "reason": "Fictional demo seed",
                    "timestamp": now,
                    "previous_version": None,
                    "new_version": 1,
                    "assessment_id": None,
                }
            )
    for role, email, institution_id, password_key in (
        ("institution_admin", settings.demo_admin_email, institution["institution_id"], "admin"),
        ("aicte_official", "official@example.test", None, "official"),
        ("verifier", "verifier@example.test", None, "verifier"),
    ):
        user_id = "demo-" + role
        user = {
            "user_id": user_id,
            "email": email,
            "email_normalized": email.casefold(),
            "password_hash": hash_password(passwords[password_key]),
            "role": role,
            "institution_id": institution_id,
            "active": True,
        }
        database.users.update_one({"user_id": user_id}, {"$set": user}, upsert=True)
    database.linked_records.update_one(
        {"record_id": "DEMO-LINKED-OLD-YEAR"}, {"$set": {
            "record_id": "DEMO-LINKED-OLD-YEAR",
            "student_id": "DEMO-STU-001",
            "institution_id": institution["institution_id"],
            "programme": "Computer Engineering",
            "academic_year": "2024-25",
            "fixture_note": "Synthetic linked-record year-mismatch example",
        }}, upsert=True
    )
    verification_token = random_verification_token()
    demo_record = database.students.find_one({"student_id": "DEMO-STU-001"}, {"record_id": 1})
    database.verification_tokens.update_one(
        {"token_id": "demo-stale-credential"},
        {"$setOnInsert": {
            "token_id": "demo-stale-credential",
            "token_hash": verification_token_hash(verification_token),
            "record_id": demo_record["record_id"],
            "claims": ["status", "institution_id", "programme", "academic_year", "issued_at"],
            "issued_at": now,
            "expires_at": datetime(2030, 1, 1, tzinfo=UTC),
            "revoked_at": None,
            "stale": True,
        }},
        upsert=True,
    )
    print("Seeded fictional institute, 3 students, linked-year fixture, and three role-specific users.")
    print("Demo passwords come only from the configured DEMO_*_PASSWORD environment variables.")
    client.close()


if __name__ == "__main__":
    main()
