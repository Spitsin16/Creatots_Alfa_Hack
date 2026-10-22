"""Возврат заявки в общую очередь, если исполнитель не действует до срока (ТЗ раздел 8, SLA).

Срок ручной проверки — 1 рабочий день (9 рабочих часов) с момента назначения.
Запускается воркером раз в минуту; идемпотентно.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Application, AuditLog
from app.services.notifications.service import send
from app.services.notifications.sla import answer_due

REVIEW_HOURS = 9


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def release_overdue(session: Session, now: datetime | None = None) -> list[str]:
    now = now or datetime.now(UTC)
    released = []
    for application in session.scalars(
        select(Application).where(Application.status == "MANUAL_REVIEW", Application.assignee_id.is_not(None))
    ):
        assigned = session.scalar(
            select(AuditLog)
            .where(AuditLog.entity_id == application.id, AuditLog.action == "APPLICATION_ASSIGNED")
            .order_by(AuditLog.at.desc())
        )
        if assigned is None:
            continue
        due = answer_due(_utc(assigned.at), hours=REVIEW_HOURS)
        if now <= due:
            continue
        previous = application.assignee_id
        application.assignee_id = None
        application.version += 1
        session.add(AuditLog(actor_id=None, action="APPLICATION_UNASSIGNED_SLA", entity="application",
                             entity_id=application.id, before={"assignee_id": previous},
                             after={"assignee_id": None, "due_at": due.isoformat()}))
        send(session, [previous], kind="STATUS", title="Заявка возвращена в очередь",
             text="Срок рассмотрения прошёл — заявку может взять другой андеррайтер.", application_id=application.id)
        released.append(application.id)
    return released
