from datetime import UTC, datetime
from typing import Any

import re

from pydantic import Field, field_validator

from app.models.common import APIModel


class Programme(APIModel):
    name: str = Field(min_length=1, max_length=120)
    approved_intake: int = Field(ge=0)
    academic_year_intake: dict[str, int] = Field(default_factory=dict)
    supernumerary_limit: int | None = Field(default=None, ge=0)

    @field_validator("academic_year_intake")
    @classmethod
    def validate_year_intakes(cls, value: dict[str, int]) -> dict[str, int]:
        for year, intake in value.items():
            if not re.fullmatch(r"\d{4}-\d{2}", year):
                raise ValueError(f"Invalid academic year: {year}")
            start, end = map(int, year.split("-"))
            if end != (start + 1) % 100 or intake < 0:
                raise ValueError(f"Invalid intake value for academic year {year}")
        return value


class InstitutionCreate(APIModel):
    institution_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    approval_reference: str = Field(min_length=1, max_length=80)
    programmes: list[Programme]


def institution_document(data: InstitutionCreate) -> dict[str, Any]:
    now = datetime.now(UTC)
    return {**data.model_dump(), "created_at": now, "updated_at": now}
