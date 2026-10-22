"""Allowed application status changes. Persistence records each change separately."""

from collections.abc import Mapping

TRANSITIONS: Mapping[str, frozenset[str]] = {
    "DRAFT": frozenset({"AWAITING_SIGNATURE", "SUBMITTED", "CANCELLED"}),
    "AWAITING_SIGNATURE": frozenset({"SUBMITTED", "CANCELLED"}),
    "SUBMITTED": frozenset({"VALIDATION", "CANCELLED"}),
    "VALIDATION": frozenset({"ENRICHMENT", "INFO_REQUESTED", "REJECTED"}),
    "ENRICHMENT": frozenset({"SCORING", "INFO_REQUESTED"}),
    "SCORING": frozenset({"APPROVED", "COUNTER_OFFER", "INFO_REQUESTED", "MANUAL_REVIEW", "REJECTED"}),
    "INFO_REQUESTED": frozenset({"SCORING", "CANCELLED"}),
    "MANUAL_REVIEW": frozenset({"APPROVED", "COUNTER_OFFER", "INFO_REQUESTED", "REJECTED"}),
    "COUNTER_OFFER": frozenset({"APPROVED", "CANCELLED", "EXPIRED"}),
    "APPROVED": frozenset({"CONTRACT_SIGNED", "EXPIRED"}),
    "CONTRACT_SIGNED": frozenset({"ISSUED"}),
    "ISSUED": frozenset(),
    "REJECTED": frozenset(),
    "CANCELLED": frozenset(),
    "EXPIRED": frozenset(),
}


class InvalidTransition(ValueError):
    """A status change is not in the application's state graph."""


def validate_transition(current: str, target: str) -> None:
    if target not in TRANSITIONS.get(current, ()):
        raise InvalidTransition(f"{current} → {target} is not allowed")
