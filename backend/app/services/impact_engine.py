from collections.abc import Mapping, Sequence
from typing import Any

from app.models.common import Finding, Severity

RELEVANT_CREDENTIAL_FIELDS = {
    "student_id",
    "apaar_identifier",
    "full_name",
    "institution_id",
    "programme",
    "academic_year",
    "admission_category",
    "status",
}


def _finding(
    rule_id: str,
    title: str,
    explanation: str,
    *,
    severity: Severity = Severity.medium,
    certainty: str = "suspected",
    action: str = "Review the affected records and document the outcome.",
    affected: Sequence[str] = (),
    human_review: bool = True,
    confirmed: bool = False,
) -> Finding:
    return Finding(
        rule_id=rule_id,
        title=title,
        explanation=explanation,
        affected_records=list(affected),
        severity=severity,
        certainty=certainty,
        recommended_action=action,
        human_review_required=human_review,
        confirmed=confirmed,
    )


def _intake(programme: Mapping[str, Any] | None, year: str) -> int | None:
    if not programme:
        return None
    by_year = programme.get("academic_year_intake", {})
    if by_year:
        return by_year.get(year)
    return programme.get("approved_intake")


def detect_impacts(
    current: Mapping[str, Any],
    proposed: Mapping[str, Any],
    *,
    institution: Mapping[str, Any] | None,
    institutions: Mapping[str, Mapping[str, Any]] | None = None,
    linked_records: Sequence[Mapping[str, Any]] = (),
    identifier_conflicts: Sequence[Mapping[str, Any]] = (),
    active_tokens: Sequence[Mapping[str, Any]] = (),
    enrolments: Mapping[tuple[str, str, str], Mapping[str, int]] | None = None,
) -> list[Finding]:
    """Analyze a proposed correction without mutating any supplied state."""
    candidate = {**current, **proposed}
    changed = {key for key, value in proposed.items() if current.get(key) != value}
    findings: list[Finding] = []
    current_ref = str(current.get("record_id", current["student_id"]))
    institution_by_id = dict(institutions or {})
    if institution and institution.get("institution_id"):
        institution_by_id.setdefault(str(institution["institution_id"]), institution)

    if "student_id" in changed or "apaar_identifier" in changed:
        if not candidate.get("student_id") or (
            "apaar_identifier" in changed and not candidate.get("apaar_identifier")
        ):
            findings.append(
                _finding(
                    "identifier.missing",
                    "Student identifier requires review",
                    "A required student identifier is missing from the proposed record.",
                    severity=Severity.high,
                    certainty="confirmed",
                    action="Provide a valid identifier before applying the correction.",
                    affected=[current_ref],
                    confirmed=True,
                )
            )
        if identifier_conflicts:
            findings.append(
                _finding(
                    "identifier.duplicate",
                    "Identifier conflicts with another record",
                    f"The proposed identifier matches {len(identifier_conflicts)} other record(s); a cross-institution match is a review lead, not proof of fraud.",
                    severity=Severity.high,
                    certainty="confirmed",
                    action="Verify the identity and resolve the duplicate before accepting this change.",
                    affected=[current_ref, *[str(r.get("record_id", r.get("student_id", ""))) for r in identifier_conflicts]],
                    confirmed=True,
                )
            )
        prior = [
            r for r in linked_records
            if current.get("apaar_hash") and r.get("apaar_hash") == current.get("apaar_hash")
        ]
        if prior:
            findings.append(
                _finding(
                    "identifier.linked_records",
                    "Linked records may retain the previous identifier",
                    f"{len(prior)} linked record(s) still refer to the prior identifier.",
                    affected=[str(r.get("record_id", r.get("student_id", ""))) for r in prior],
                    action="Reconcile linked records without changing another institution's data automatically.",
                )
            )

    if {"institution_id", "programme"} & changed:
        destination = candidate.get("institution_id")
        prog = candidate.get("programme")
        destination_institution = institution_by_id.get(str(destination), institution)
        institution_programmes = (destination_institution or {}).get("programmes", [])
        names = {p.get("name") for p in institution_programmes}
        if not destination_institution or destination_institution.get("institution_id") != destination or prog not in names:
            findings.append(
                _finding(
                    "programme.destination_unknown",
                    "Destination programme needs validation",
                    "The destination institution/programme was not found in the supplied approved programme data.",
                    severity=Severity.high,
                    certainty="confirmed",
                    action="Confirm the destination institution and programme before applying a transfer.",
                    affected=[current_ref],
                    confirmed=True,
                )
            )
        linked = [r for r in linked_records if r.get("institution_id") == current.get("institution_id") or r.get("programme") == current.get("programme")]
        if linked:
            findings.append(
                _finding(
                    "programme.linked_records",
                    "Institution-specific records require review",
                    f"{len(linked)} linked record(s) may reference the previous institution or programme.",
                    affected=[str(r.get("record_id", r.get("student_id", ""))) for r in linked],
                    action="Review admission and institution-specific records; do not transfer them automatically.",
                )
            )

    if {"admission_category", "nri_status", "oci_status", "foreign_national_status"} & changed:
        special_categories = sum(
            bool(candidate.get(field))
            for field in ("nri_status", "oci_status", "foreign_national_status")
        )
        if special_categories > 1:
            findings.append(
                _finding(
                    "admission.category_inconsistent",
                    "Admission category flags conflict",
                    "The proposed record marks more than one of NRI, OCI, and foreign national status.",
                    severity=Severity.high,
                    certainty="confirmed",
                    action="Confirm the student's category from authoritative documentation before applying.",
                    affected=[current_ref],
                    confirmed=True,
                )
            )
        elif candidate.get("admission_category", "").casefold() not in {"regular", "general"} and not any(
            candidate.get(field) for field in ("nri_status", "oci_status", "foreign_national_status")
        ):
            findings.append(
                _finding(
                    "admission.category_unverified",
                    "Admission category needs supporting review",
                    "A non-regular admission category is present without a corresponding NRI, OCI, or foreign-national status flag.",
                    action="Check the configured admission policy and supporting documentation.",
                )
            )

    if "academic_year" in changed:
        year_records = [r for r in linked_records if r.get("academic_year") == current.get("academic_year")]
        findings.append(
            _finding(
                "academic_year.reconciliation",
                "Academic-year metrics need recalculation",
                f"Recalculate enrolment for {current.get('academic_year')} and {candidate.get('academic_year')}; {len(year_records)} linked record(s) still reference the previous year.",
                affected=[str(r.get("record_id", r.get("student_id", ""))) for r in year_records],
                action="Reconcile linked records and compare both year-specific intakes.",
            )
        )

    category_changed = bool({"admission_category", "supernumerary_seat_status"} & changed)
    intake_keys = {
        (current.get("institution_id"), current.get("programme"), current.get("academic_year")),
        (candidate.get("institution_id"), candidate.get("programme"), candidate.get("academic_year")),
    }
    for key in intake_keys:
        institution_id, programme_name, academic_year = key
        related_institution = institution_by_id.get(str(institution_id))
        if related_institution is None and institution and institution.get("institution_id") == institution_id:
            related_institution = institution
        programme = next(
            (p for p in (related_institution or {}).get("programmes", []) if p.get("name") == programme_name),
            None,
        )
        limit = _intake(programme, str(academic_year))
        if limit is None:
            if key == (candidate.get("institution_id"), candidate.get("programme"), candidate.get("academic_year")):
                findings.append(
                    _finding(
                        "intake.policy_unconfigured",
                        "Seat allocation policy is not configured",
                        "No applicable programme intake was supplied; intake compliance cannot be confirmed.",
                        certainty="unknown",
                        action="Configure year-specific approved intake and supernumerary limits.",
                    )
                )
            continue
        counts = (enrolments or {}).get(key, {})
        regular = int(counts.get("regular", 0))
        supernumerary = int(counts.get("supernumerary", 0))
        old_match = key == (
            current.get("institution_id"), current.get("programme"), current.get("academic_year")
        )
        if old_match:
            if current.get("supernumerary_seat_status"):
                supernumerary -= 1
            else:
                regular -= 1
        if key == (candidate.get("institution_id"), candidate.get("programme"), candidate.get("academic_year")):
            if candidate.get("supernumerary_seat_status"):
                supernumerary += 1
            else:
                regular += 1
        proposed_total = regular + supernumerary
        seat_limit = programme.get("supernumerary_limit")
        exceeds = proposed_total > limit or (
            seat_limit is not None and supernumerary > seat_limit
        )
        if exceeds:
            findings.append(
                _finding(
                    "intake.threshold",
                    "Proposed enrolment exceeds configured capacity",
                    f"{institution_id}/{programme_name}/{academic_year}: proposed total {proposed_total}, approved intake {limit}; regular and supernumerary seats are evaluated separately.",
                    severity=Severity.high,
                    certainty="confirmed",
                    action="Verify approved intake and seat category; obtain authorized review before applying.",
                    affected=[current_ref],
                    confirmed=True,
                )
            )
        elif category_changed and seat_limit is None and (
            key == (candidate.get("institution_id"), candidate.get("programme"), candidate.get("academic_year"))
        ):
            findings.append(
                _finding(
                    "intake.supernumerary_policy",
                    "Supernumerary policy needs human review",
                    "A category or supernumerary status changed, but no explicit supernumerary limit is configured.",
                    certainty="unknown",
                    action="Confirm the applicable seat-allocation policy and record reviewer findings.",
                )
            )

    if changed & RELEVANT_CREDENTIAL_FIELDS and active_tokens:
        findings.append(
            _finding(
                "verification.credentials_stale",
                "Issued verification credentials may be outdated",
                f"{len(active_tokens)} issued credential(s) include claims affected by this correction and will require revalidation.",
                severity=Severity.medium,
                certainty="confirmed",
                action="Mark affected credentials stale and issue replacements only after review.",
                affected=[str(t.get("token_id", "")) for t in active_tokens],
                confirmed=True,
            )
        )
    if changed & {"admission_category", "supernumerary_seat_status"}:
        findings.append(
            _finding(
                "admission.category_review",
                "Admission category change requires allocation review",
                "Check category consistency and regular/supernumerary allocation against explicitly configured policy.",
                action="Review eligibility and applicable seat limits; unsupported policies must be assessed manually.",
            )
        )
    return findings


def build_review_tasks(assessment: Mapping[str, Any]) -> list[dict[str, Any]]:
    from datetime import UTC, datetime
    from uuid import uuid4

    now = datetime.now(UTC)
    tasks = []
    for finding in assessment["findings"]:
        if not finding["human_review_required"]:
            continue
        tasks.append(
            {
                "task_id": str(uuid4()),
                "assessment_id": assessment["assessment_id"],
                "affected_record_id": assessment["record_id"],
                "institution_id": assessment["institution_id"],
                "title": finding["title"],
                "explanation": finding["explanation"],
                "suggested_action": finding["recommended_action"],
                "severity": finding["severity"],
                "priority": {"critical": 1, "high": 2, "medium": 3, "low": 4}[finding["severity"]],
                "status": "open",
                "assigned_reviewer": None,
                "review_note": None,
                "outcome": None,
                "created_at": now,
                "updated_at": now,
            }
        )
    return tasks
