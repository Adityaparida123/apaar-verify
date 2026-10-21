import re
from datetime import date
from typing import Any

from pydantic import Field, field_validator

from app.models.common import APIModel, RecordStatus

YEAR_PATTERN = re.compile(r"^\d{4}-\d{2}$")


class StudentFields(APIModel):
    student_id: str = Field(min_length=1, max_length=64)
    apaar_identifier: str | None = Field(default=None, min_length=12, max_length=12)
    full_name: str = Field(min_length=1, max_length=160)
    institution_id: str = Field(min_length=1, max_length=64)
    programme: str = Field(min_length=1, max_length=120)
    academic_year: str = Field(pattern=r"^\d{4}-\d{2}$")
    admission_date: date
    admission_category: str = Field(default="regular", min_length=1, max_length=64)
    nri_status: bool = False
    oci_status: bool = False
    foreign_national_status: bool = False
    supernumerary_seat_status: bool = False
    status: RecordStatus = RecordStatus.active

    @field_validator("student_id", "institution_id")
    @classmethod
    def validate_identifiers(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9._-]+", value):
            raise ValueError("Use only letters, numbers, dots, underscores, or hyphens")
        return value

    @field_validator("academic_year")
    @classmethod
    def valid_academic_year(cls, value: str) -> str:
        start, end = map(int, value.split("-"))
        if not YEAR_PATTERN.fullmatch(value) or end != (start + 1) % 100:
            raise ValueError("Academic year must be a consecutive YYYY-YY range, for example 2025-26")
        return value

    @field_validator("apaar_identifier")
    @classmethod
    def validate_apaar_format(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"\d{12}", value):
            raise ValueError("APAAR identifier must contain exactly 12 digits")
        return value


class StudentCreate(StudentFields):
    pass


class StudentPatch(APIModel):
    apaar_identifier: str | None = Field(default=None, min_length=12, max_length=12)
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    institution_id: str | None = Field(default=None, min_length=1, max_length=64)
    programme: str | None = Field(default=None, min_length=1, max_length=120)
    academic_year: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    admission_date: date | None = None
    admission_category: str | None = Field(default=None, min_length=1, max_length=64)
    nri_status: bool | None = None
    oci_status: bool | None = None
    foreign_national_status: bool | None = None
    supernumerary_seat_status: bool | None = None
    status: RecordStatus | None = None

    @field_validator("apaar_identifier")
    @classmethod
    def validate_apaar_format(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"\d{12}", value):
            raise ValueError("APAAR identifier must contain exactly 12 digits")
        return value

    def changes(self) -> dict[str, Any]:
        changes = self.model_dump(exclude_unset=True)
        if not changes:
            raise ValueError("Provide at least one field to change")
        if "academic_year" in changes and changes["academic_year"] is not None:
            start, end = map(int, changes["academic_year"].split("-"))
            if not YEAR_PATTERN.fullmatch(changes["academic_year"]) or end != (start + 1) % 100:
                raise ValueError("Academic year must be a consecutive YYYY-YY range, for example 2025-26")
        return changes


class StudentResponse(APIModel):
    student_id: str
    full_name: str
    institution_id: str
    programme: str
    academic_year: str
    admission_date: date
    admission_category: str
    nri_status: bool
    oci_status: bool
    foreign_national_status: bool
    supernumerary_seat_status: bool
    status: RecordStatus
    version: int
    masked_apaar_identifier: str | None = None
