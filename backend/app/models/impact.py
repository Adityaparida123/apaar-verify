from datetime import datetime
from typing import Any

from pydantic import Field

from app.models.common import APIModel, Finding


class CorrectionPreview(APIModel):
    changes: dict[str, Any]
    expected_version: int = Field(ge=1)


class CorrectionApply(CorrectionPreview):
    reason: str = Field(min_length=3, max_length=1000)


class ImpactAssessment(APIModel):
    assessment_id: str
    record_id: str
    institution_id: str
    triggering_version: int
    changed_fields: list[str]
    findings: list[Finding]
    status: str
    created_at: datetime
