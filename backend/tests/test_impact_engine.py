from app.services.impact_engine import detect_impacts


def test_normal_field_correction_has_no_impact_findings() -> None:
    student = {
        "student_id": "S-1",
        "institution_id": "I-1",
        "programme": "Computing",
        "academic_year": "2025-26",
        "admission_category": "regular",
        "supernumerary_seat_status": False,
    }
    institution = {
        "institution_id": "I-1",
        "programmes": [{"name": "Computing", "approved_intake": 10}],
    }

    result = detect_impacts(
        student,
        {"full_name": "Updated Name"},
        institution=institution,
        enrolments={("I-1", "Computing", "2025-26"): {"regular": 1, "supernumerary": 0}},
    )

    assert result == []


def test_duplicate_identifier_is_review_finding_not_fraud_claim() -> None:
    student = {
        "student_id": "S-1",
        "institution_id": "I-1",
        "programme": "Computing",
        "academic_year": "2025-26",
        "admission_category": "regular",
        "supernumerary_seat_status": False,
    }
    findings = detect_impacts(
        student,
        {"apaar_identifier": "510000000002"},
        institution=None,
        identifier_conflicts=[{"student_id": "S-2", "institution_id": "I-2"}],
    )

    duplicate = next(finding for finding in findings if finding.rule_id == "identifier.duplicate")
    assert duplicate.confirmed
    assert duplicate.human_review_required
    assert "not proof of fraud" in duplicate.explanation


def test_programme_change_detects_capacity_overflow() -> None:
    student = {
        "student_id": "S-3",
        "institution_id": "I-1",
        "programme": "Civil",
        "academic_year": "2025-26",
        "admission_category": "regular",
        "supernumerary_seat_status": False,
    }
    institution = {
        "institution_id": "I-1",
        "programmes": [
            {"name": "Civil", "approved_intake": 5},
            {"name": "Computing", "approved_intake": 2},
        ],
    }
    findings = detect_impacts(
        student,
        {"programme": "Computing"},
        institution=institution,
        enrolments={
            ("I-1", "Civil", "2025-26"): {"regular": 1, "supernumerary": 0},
            ("I-1", "Computing", "2025-26"): {"regular": 2, "supernumerary": 0},
        },
    )

    assert any(item.rule_id == "intake.threshold" and item.confirmed for item in findings)


def test_academic_year_change_reports_linked_record_and_credentials() -> None:
    student = {
        "student_id": "S-1",
        "institution_id": "I-1",
        "programme": "Computing",
        "academic_year": "2025-26",
        "admission_category": "regular",
        "supernumerary_seat_status": False,
    }
    findings = detect_impacts(
        student,
        {"academic_year": "2026-27"},
        institution={"institution_id": "I-1", "programmes": [{"name": "Computing", "approved_intake": 10}]},
        linked_records=[{"record_id": "L-1", "academic_year": "2025-26"}],
        active_tokens=[{"token_id": "T-1"}],
    )

    rule_ids = {finding.rule_id for finding in findings}
    assert "academic_year.reconciliation" in rule_ids
    assert "verification.credentials_stale" in rule_ids


def test_missing_year_specific_intake_is_not_replaced_by_global_intake() -> None:
    student = {
        "student_id": "S-1",
        "institution_id": "I-1",
        "programme": "Computing",
        "academic_year": "2025-26",
        "admission_category": "regular",
        "supernumerary_seat_status": False,
    }
    findings = detect_impacts(
        student,
        {"academic_year": "2026-27"},
        institution={
            "institution_id": "I-1",
            "programmes": [
                {
                    "name": "Computing",
                    "approved_intake": 8,
                    "academic_year_intake": {"2025-26": 4},
                }
            ],
        },
        enrolments={("I-1", "Computing", "2025-26"): {"regular": 1}},
    )

    assert any(item.rule_id == "intake.policy_unconfigured" for item in findings)


def test_institution_transfer_checks_destination_intake_using_its_programme() -> None:
    student = {
        "record_id": "record-1",
        "student_id": "S-1",
        "institution_id": "I-1",
        "programme": "Computing",
        "academic_year": "2025-26",
        "admission_category": "regular",
        "supernumerary_seat_status": False,
    }
    institutions = {
        "I-1": {
            "institution_id": "I-1",
            "programmes": [{"name": "Computing", "approved_intake": 5}],
        },
        "I-2": {
            "institution_id": "I-2",
            "programmes": [{"name": "Computing", "approved_intake": 2}],
        },
    }

    findings = detect_impacts(
        student,
        {"institution_id": "I-2"},
        institution=institutions["I-2"],
        institutions=institutions,
        enrolments={
            ("I-1", "Computing", "2025-26"): {"regular": 1},
            ("I-2", "Computing", "2025-26"): {"regular": 2},
        },
    )

    threshold = next(item for item in findings if item.rule_id == "intake.threshold")
    assert "I-2/Computing/2025-26" in threshold.explanation
    assert "proposed total 3" in threshold.explanation
