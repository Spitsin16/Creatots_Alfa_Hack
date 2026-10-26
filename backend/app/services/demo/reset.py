"""Сброс демо-стенда к состоянию после первого запуска: без заявок, решений, чатов и клиентов песочницы.

Демо-учётки (клиенты-персоны и сотрудники), их бизнесы, снимки источников и первая версия правил остаются —
это то, что кладёт `app.seed`. Время демо не трогаем: «сегодня» задаётся DEMO_TODAY.
"""

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import (
    Application,
    Approval,
    AuditLog,
    Business,
    Consent,
    Contract,
    DataSnapshot,
    Decision,
    Document,
    Membership,
    Message,
    Notification,
    Outbox,
    PreOffer,
    Rule,
    Segment,
    Statement,
    StatusHistory,
    StoredFile,
    User,
)

# Порядок важен: сначала то, что ссылается на заявки и предрасчёты, потом сами заявки
RUNTIME_TABLES = (
    Notification, Message, Outbox, Approval, Contract, Decision, StatusHistory, Document, StoredFile,
    Application, PreOffer, Statement, Consent, AuditLog,
)


def reset_demo(session: Session) -> dict:
    """Удаляет всё, что появилось за время показа. Возвращает, сколько строк убрано по таблицам."""
    removed: dict[str, int] = {}
    for model in RUNTIME_TABLES:
        removed[model.__tablename__] = session.execute(delete(model)).rowcount or 0

    # Клиенты песочницы: логин sbx…, их бизнесы и снимки
    sandbox_users = list(session.scalars(select(User.id).where(User.login.like("sbx%"))))
    sandbox_businesses = list(session.scalars(
        select(Membership.business_id).where(Membership.user_id.in_(sandbox_users)))) if sandbox_users else []
    if sandbox_users:
        session.execute(delete(Membership).where(
            Membership.user_id.in_(sandbox_users) | Membership.business_id.in_(sandbox_businesses)))
    if sandbox_businesses:
        session.execute(delete(DataSnapshot).where(DataSnapshot.business_id.in_(sandbox_businesses)))
        session.execute(delete(Segment).where(Segment.business_id.in_(sandbox_businesses)))
        session.execute(delete(Business).where(Business.id.in_(sandbox_businesses)))
    if sandbox_users:
        session.execute(delete(User).where(User.id.in_(sandbox_users)))
    removed["sandbox_clients"] = len(sandbox_users)

    # Правила: остаётся первая версия, и она действующая
    first = session.scalar(select(Rule.version).order_by(Rule.version))
    if first is not None:
        removed["rules"] = session.execute(delete(Rule).where(Rule.version != first)).rowcount or 0
        session.execute(update(Rule).where(Rule.version == first).values(active=True))
    return removed
