from datetime import UTC, datetime
import re
from typing import Any
from uuid import uuid4


def _safe_reason(reason: str | None) -> str | None:
    if reason is None:
        return None
    redacted = re.sub(r"\b\d{12}\b", "[REDACTED IDENTIFIER]", reason)
    return re.sub(
        r"\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b",
        "[REDACTED TOKEN]",
        re.sub(
            r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])",
            "[REDACTED TOKEN]",
            redacted,
        ),
    )


def audit_event(
    actor: dict[str, Any],
    action: str,
    *,
    target_record_id: str | None = None,
    institution_id: str | None = None,
    changed_fields: list[str] | None = None,
    outcome: str = "success",
    reason: str | None = None,
) -> dict[str, Any]:
    return {
        "actor_id": actor["user_id"],
        "actor_role": actor["role"],
        "action": action,
        "target_record_id": target_record_id,
        "institution_id": institution_id,
        "changed_fields": changed_fields or [],
        "timestamp": datetime.now(UTC),
        "outcome": outcome,
        "correlation_id": str(uuid4()),
        "reason": _safe_reason(reason),
    }
