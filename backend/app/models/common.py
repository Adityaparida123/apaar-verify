from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    return datetime.now(UTC)


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Role(StrEnum):
    institution_admin = "institution_admin"
    aicte_official = "aicte_official"
    verifier = "verifier"


class RecordStatus(StrEnum):
    active = "active"
    archived = "archived"
    suspended = "suspended"


class Severity(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Finding(APIModel):
    rule_id: str
    title: str
    explanation: str
    affected_records: list[str] = Field(default_factory=list)
    severity: Severity
    certainty: str
    recommended_action: str
    human_review_required: bool
    confirmed: bool = False
