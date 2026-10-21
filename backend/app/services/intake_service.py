from typing import Any


def _approved_intake(programme: dict[str, Any], academic_year: str | None) -> int | None:
    by_year = programme.get("academic_year_intake", {})
    if by_year:
        return by_year.get(academic_year)
    return programme.get("approved_intake")


def calculate_intake(database: Any, institution_id: str | None = None) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"status": "active"}
    if institution_id:
        query["institution_id"] = institution_id
    records = list(database.students.find(query, {"_id": 0}))
    groups: dict[tuple[str, str, str], dict[str, int]] = {}
    for record in records:
        key = (record["institution_id"], record["programme"], record["academic_year"])
        counts = groups.setdefault(key, {"regular": 0, "supernumerary": 0})
        bucket = "supernumerary" if record.get("supernumerary_seat_status") else "regular"
        counts[bucket] += 1

    institutions_query = {"institution_id": institution_id} if institution_id else {}
    comparisons = []
    for institution in database.institutions.find(institutions_query, {"_id": 0}):
        for programme in institution.get("programmes", []):
            academic_years = set(programme.get("academic_year_intake", {}))
            academic_years.update(
                year for inst_id, name, year in groups
                if inst_id == institution["institution_id"] and name == programme["name"]
            )
            if not academic_years:
                academic_years.add(None)
            for year in sorted(academic_years, key=lambda value: value or ""):
                intake = _approved_intake(programme, year)
                counts = groups.get((institution["institution_id"], programme["name"], year), {})
                regular = counts.get("regular", 0)
                supernumerary = counts.get("supernumerary", 0)
                total = regular + supernumerary
                super_limit = programme.get("supernumerary_limit")
                comparisons.append(
                    {
                        "institution_id": institution["institution_id"],
                        "programme": programme["name"],
                        "academic_year": year,
                        "approved_intake": intake,
                        "actual_enrolment": total,
                        "regular_enrolment": regular,
                        "supernumerary_enrolment": supernumerary,
                        "remaining_capacity": max(0, intake - total) if intake is not None else None,
                        "excess_enrolment": max(0, total - intake) if intake is not None else None,
                        "supernumerary_limit": super_limit,
                        "supernumerary_excess": (
                            max(0, supernumerary - super_limit) if super_limit is not None else None
                        ),
                    }
                )
    return comparisons
