"""Истечение одобрений: APPROVED / COUNTER_OFFER без действий клиента 30 дней → EXPIRED (ТЗ раздел 8)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Application, AuditLog, StatusHistory
from app.services.application_flow import transition_application

OFFER_VALID_DAYS = 30


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def expire_offers(session: Session, now: datetime | None = None, valid_days: int = OFFER_VALID_DAYS) -> list[str]:
    now = now or datetime.now(UTC)
    expired = []
    for application in session.scalars(select(Application).where(Application.status.in_(("APPROVED", "COUNTER_OFFER")))):
        since = session.scalar(
            select(StatusHistory.at)
            .where(StatusHistory.application_id == application.id, StatusHistory.to_status == application.status)
            .order_by(StatusHistory.at.desc())
        )
        if since is None or _utc(since) + timedelta(days=valid_days) > now:
            continue
        previous = application.status
        transition_application(session, application, "EXPIRED", actor_id=None,
                               comment=f"Предложение не принято за {valid_days} дней")
        session.add(AuditLog(actor_id=None, action="OFFER_EXPIRED", entity="application", entity_id=application.id,
                             before={"status": previous}, after={"status": "EXPIRED"}))
        expired.append(application.id)
    return expired
