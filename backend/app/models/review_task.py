from datetime import datetime
from typing import Literal

from pydantic import Field

from app.models.common import APIModel, Severity


class ReviewTaskUpdate(APIModel):
    status: Literal["in_progress", "resolved", "dismissed"]
    review_note: str = Field(min_length=1, max_length=2000)
    outcome: str | None = Field(default=None, max_length=1000)


class ReviewTask(APIModel):
    task_id: str
    assessment_id: str
    affected_record_id: str | None
    institution_id: str
    title: str
    explanation: str
    suggested_action: str
    severity: Severity
    priority: int
    status: str
    assigned_reviewer: str | None
    review_note: str | None
    outcome: str | None
    created_at: datetime
    updated_at: datetime
