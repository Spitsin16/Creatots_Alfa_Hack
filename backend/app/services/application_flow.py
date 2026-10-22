"""Transactional helpers for application status changes."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import Application, StatusHistory
from app.states import InvalidTransition, validate_transition


def transition_application(
    session: Session,
    application: Application,
    target: str,
    *,
    actor_id: str | None,
    comment: str,
) -> None:
    try:
        validate_transition(application.status, target)
    except InvalidTransition:
        raise
    previous = application.status
    application.status = target
    application.version += 1
    session.add(
        StatusHistory(
            application_id=application.id,
            from_status=previous,
            to_status=target,
            actor_id=actor_id,
            comment=comment,
            at=datetime.now(UTC),
        )
    )
