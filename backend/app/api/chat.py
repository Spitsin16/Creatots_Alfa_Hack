"""Чат по заявке и уведомления в кабинете (ТЗ 5.3, раздел 11).

Чат не заменяет решение: одобрение, запрос документов и отказ — только действиями
со статусами и кодами причин в кабинете банка.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_session, require_membership
from app.api.errors import APIError
from app.models import Application, AuditLog, Message, Notification, User
from app.services.notifications.service import notify_bank_message, notify_client_message
from app.services.notifications.sla import answer_due, due_text

router = APIRouter(prefix="/api/v1", tags=["chat"])
BANK_CHAT_ROLES = {"UNDERWRITER", "RISK_MANAGER"}


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class MessageOut(BaseModel):
    id: str
    author_side: str
    author_name: str
    text: str
    created_at: datetime
    answer_due_at: datetime | None
    answered_at: datetime | None


class ChatOut(BaseModel):
    items: list[MessageOut]
    open_question_due_at: datetime | None
    open_question_due_text: str | None
    overdue: bool


class NotificationOut(BaseModel):
    id: str
    kind: str
    title: str
    text: str
    application_id: str | None
    created_at: datetime
    read: bool


class NotificationPage(BaseModel):
    items: list[NotificationOut]
    unread_count: int


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _access(session: Session, user: User, application_id: str) -> tuple[Application, str]:
    application = session.get(Application, application_id)
    if application is None:
        raise APIError(404, "APPLICATION_NOT_FOUND", "Заявка не найдена")
    if user.role in BANK_CHAT_ROLES:
        return application, "BANK"
    if user.role == "CLIENT":
        require_membership(session, user, application.business_id, "VIEW")
        return application, "CLIENT"
    raise APIError(403, "ROLE_DENIED", "Чат доступен клиенту и сотрудникам, ведущим заявку")


def _chat(session: Session, application_id: str) -> ChatOut:
    messages = session.scalars(
        select(Message).where(Message.application_id == application_id).order_by(Message.created_at, Message.id)
    ).all()
    names = {u.id: u.full_name for u in session.scalars(select(User).where(User.id.in_({m.author_id for m in messages})))}
    open_due = [
        _utc(m.answer_due_at) for m in messages if m.author_side == "CLIENT" and m.answered_at is None and m.answer_due_at
    ]
    due = min(open_due) if open_due else None
    now = datetime.now(UTC)
    return ChatOut(
        items=[
            MessageOut(
                id=m.id,
                author_side=m.author_side,
                author_name=names.get(m.author_id, "") if m.author_side == "CLIENT" else "Специалист банка",
                text=m.text,
                created_at=_utc(m.created_at),
                answer_due_at=_utc(m.answer_due_at) if m.answer_due_at else None,
                answered_at=_utc(m.answered_at) if m.answered_at else None,
            )
            for m in messages
        ],
        open_question_due_at=due,
        open_question_due_text=due_text(due, now) if due else None,
        overdue=bool(due and due < now),
    )


@router.get("/applications/{application_id}/messages", response_model=ChatOut)
def list_messages(
    application_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> ChatOut:
    _access(session, user, application_id)
    return _chat(session, application_id)


@router.post("/applications/{application_id}/messages", response_model=ChatOut, status_code=201)
def post_message(
    application_id: str,
    payload: MessageIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChatOut:
    application, side = _access(session, user, application_id)
    now = datetime.now(UTC)
    text = payload.text.strip()
    if not text:
        raise APIError(422, "EMPTY_MESSAGE", "Напишите сообщение")
    message = Message(
        application_id=application.id,
        author_id=user.id,
        author_side=side,
        text=text,
        answer_due_at=answer_due(now) if side == "CLIENT" else None,
        created_at=now,
    )
    session.add(message)
    if side == "BANK":
        for question in session.scalars(
            select(Message).where(
                Message.application_id == application.id,
                Message.author_side == "CLIENT",
                Message.answered_at.is_(None),
            )
        ):
            question.answered_at = now
        notify_client_message(session, application, text)
    else:
        notify_bank_message(session, application, text)
    session.flush()
    session.add(
        AuditLog(
            actor_id=user.id,
            action="CHAT_MESSAGE",
            entity="application",
            entity_id=application.id,
            before=None,
            after={"message_id": message.id, "side": side},
        )
    )
    session.commit()
    return _chat(session, application.id)


@router.get("/notifications", response_model=NotificationPage)
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> NotificationPage:
    filters = [Notification.user_id == user.id, Notification.channel == "IN_APP"]
    unread = session.scalar(
        select(func.count()).select_from(Notification).where(*filters, Notification.read_at.is_(None))
    )
    if unread_only:
        filters.append(Notification.read_at.is_(None))
    items = session.scalars(
        select(Notification).where(*filters).order_by(Notification.created_at.desc(), Notification.id).limit(limit)
    ).all()
    return NotificationPage(
        items=[
            NotificationOut(
                id=n.id,
                kind=n.kind,
                title=n.title,
                text=n.text,
                application_id=n.application_id,
                created_at=_utc(n.created_at),
                read=n.read_at is not None,
            )
            for n in items
        ],
        unread_count=unread or 0,
    )


@router.post("/notifications/{notification_id}/read", status_code=204)
def read_notification(
    notification_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> None:
    n = session.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise APIError(404, "NOTIFICATION_NOT_FOUND", "Уведомление не найдено")
    n.read_at = n.read_at or datetime.now(UTC)
    session.commit()


@router.post("/notifications/read-all", status_code=204)
def read_all(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> None:
    now = datetime.now(UTC)
    for n in session.scalars(
        select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    ):
        n.read_at = now
    session.commit()
