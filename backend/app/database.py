from functools import lru_cache
from typing import Any

from pymongo import ASCENDING, MongoClient
from pymongo.errors import PyMongoError

from app.config import get_settings


@lru_cache
def get_client() -> MongoClient[Any]:
    uri = get_settings().mongodb_uri
    if not uri:
        raise RuntimeError("MONGODB_URI is not configured")
    return MongoClient(uri, serverSelectionTimeoutMS=3000, tz_aware=True)


def get_database() -> Any:
    return get_client()[get_settings().mongodb_database]


def ensure_indexes(database: Any) -> None:
    database.students.create_index(
        [("record_id", ASCENDING)],
        unique=True,
        name="student_record_id_unique",
    )
    database.students.create_index(
        [("institution_id", ASCENDING), ("student_id_normalized", ASCENDING)],
        unique=True,
        name="institution_student_id_unique",
    )
    database.students.create_index(
        [("apaar_hash", ASCENDING)],
        unique=True,
        partialFilterExpression={"apaar_hash": {"$type": "string"}},
        name="apaar_hash_unique_when_present",
    )
    database.students.create_index(
        [("institution_id", ASCENDING), ("academic_year", ASCENDING), ("status", ASCENDING)],
        name="institution_year_status",
    )
    database.students.create_index(
        [("institution_id", ASCENDING), ("programme", ASCENDING), ("academic_year", ASCENDING)],
        name="institution_programme_year",
    )
    database.students.create_index([("student_id", ASCENDING)], name="student_id_lookup")
    database.linked_records.create_index([("student_id", ASCENDING)], name="linked_student_lookup")
    database.linked_records.create_index(
        [("apaar_hash", ASCENDING)],
        partialFilterExpression={"apaar_hash": {"$type": "string"}},
        name="linked_apaar_hash_lookup",
    )
    database.record_versions.create_index(
        [("record_id", ASCENDING), ("version", ASCENDING)], unique=True, name="record_version_unique"
    )
    database.impact_assessments.create_index([("assessment_id", ASCENDING)], unique=True)
    database.impact_assessments.create_index([("institution_id", ASCENDING), ("created_at", -1)])
    database.review_tasks.create_index([("task_id", ASCENDING)], unique=True)
    database.review_tasks.create_index([("institution_id", ASCENDING), ("status", ASCENDING)])
    database.audit_logs.create_index([("timestamp", -1)])
    database.audit_logs.create_index([("target_record_id", ASCENDING), ("timestamp", -1)])
    database.verification_tokens.create_index([("token_hash", ASCENDING)], unique=True)
    database.verification_tokens.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    database.users.create_index([("email_normalized", ASCENDING)], unique=True)
    database.institutions.create_index([("institution_id", ASCENDING)], unique=True)


def database_status() -> bool:
    try:
        get_client().admin.command("ping")
        return True
    except (RuntimeError, PyMongoError):
        return False


def close_database() -> None:
    if get_client.cache_info().currsize:
        get_client().close()
        get_client.cache_clear()
