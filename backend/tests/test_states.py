import pytest

from app.states import TRANSITIONS, InvalidTransition, validate_transition


@pytest.mark.parametrize(
    ("current", "target"),
    [("DRAFT", "SUBMITTED"), ("SUBMITTED", "VALIDATION"), ("SCORING", "MANUAL_REVIEW"),
     ("APPROVED", "CONTRACT_SIGNED"), ("CONTRACT_SIGNED", "ISSUED")],
)
def test_allowed_transitions(current: str, target: str) -> None:
    validate_transition(current, target)


@pytest.mark.parametrize(
    ("current", "target"),
    [("DRAFT", "ISSUED"), ("REJECTED", "APPROVED"), ("ISSUED", "SUBMITTED"),
     ("APPROVED", "REJECTED"), ("NOT_A_STATUS", "DRAFT")],
)
def test_illegal_transitions_are_rejected(current: str, target: str) -> None:
    with pytest.raises(InvalidTransition):
        validate_transition(current, target)


def test_terminal_statuses_have_no_exits() -> None:
    for status in ("ISSUED", "REJECTED", "CANCELLED", "EXPIRED"):
        assert not TRANSITIONS[status]
