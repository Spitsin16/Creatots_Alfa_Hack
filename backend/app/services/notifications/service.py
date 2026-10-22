"""Уведомления: в кабинете (IN_APP) и SMS-заглушка.

SMS в демо ничего не отправляет — пишет «отправлено бы SMS: …» в журнал аудита и лог
(ТЗ 5.3). В проде здесь подключается шлюз банка.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Application, AuditLog, Membership, Notification, User

log = logging.getLogger("notifications")

# Статус -> (заголовок, текст, слать ли SMS). Технические этапы конвейера не уведомляем.
STATUS_MESSAGES: dict[str, tuple[str, str, bool]] = {
    "AWAITING_SIGNATURE": ("Заявка ждёт отправки", "Сотрудник подготовил заявку — проверьте и отправьте её в банк.", False),
    "SUBMITTED": ("Заявка отправлена", "Мы получили заявку и уже проверяем данные.", False),
    "MANUAL_REVIEW": ("Заявку смотрит специалист", "Решение будет в течение рабочего дня. Вопросы — в чате заявки.", False),
    "INFO_REQUESTED": ("Банк запросил документы", "Откройте заявку и приложите документы — без них решение не принять.", True),
    "APPROVED": ("Кредит одобрен", "Откройте заявку и подпишите договор кодом.", True),
    "COUNTER_OFFER": ("Есть предложение банка", "Запрошенную сумму выдать не можем — посмотрите вариант банка.", True),
    "REJECTED": ("Решение по заявке", "Сейчас выдать кредит не можем. В заявке — причина и что поможет в следующий раз.", True),
    "ISSUED": ("Деньги на счёте", "Кредит выдан и зачислен на ваш расчётный счёт.", True),
    "CANCELLED": ("Заявка отменена", "Заявка закрыта без выдачи.", False),
}


def _client_user_ids(session: Session, business_id: str) -> list[str]:
    members = session.scalars(select(Membership).where(Membership.business_id == business_id)).all()
    return [m.user_id for m in members if "VIEW" in (m.permissions or [])]


def send(
    session: Session,
    user_ids: list[str],
    *,
    kind: str,
    title: str,
    text: str,
    application_id: str | None = None,
    sms: bool = False,
) -> list[Notification]:
    out = []
    for user_id in dict.fromkeys(user_ids):
        n = Notification(user_id=user_id, application_id=application_id, kind=kind, channel="IN_APP",
                         title=title, text=text)
        session.add(n)
        out.append(n)
        if sms:
            user = session.get(User, user_id)
            body = f"{title}. {text}"
            session.add(Notification(user_id=user_id, application_id=application_id, kind=kind, channel="SMS",
                                     title=title, text=body))
            session.add(AuditLog(actor_id=None, action="SMS_STUB", entity="user", entity_id=user_id, before=None,
                                 after={"to": user.login if user else user_id, "text": body,
                                        "note": "отправлено бы SMS (демо-заглушка, шлюз не подключён)"}))
            log.info("SMS-заглушка: отправлено бы SMS пользователю %s: %s", user_id, body)
    return out


def notify_status(session: Session, application: Application, status: str) -> None:
    message = STATUS_MESSAGES.get(status)
    if message is None:
        return
    title, text, sms = message
    send(session, _client_user_ids(session, application.business_id), kind="STATUS", title=title, text=text,
         application_id=application.id, sms=sms)


def notify_client_message(session: Session, application: Application, preview: str) -> None:
    send(session, _client_user_ids(session, application.business_id), kind="MESSAGE",
         title="Ответ банка в чате", text=preview[:200], application_id=application.id)


def notify_bank_message(session: Session, application: Application, preview: str) -> None:
    if application.assignee_id:
        recipients = [application.assignee_id]
    else:
        recipients = list(session.scalars(select(User.id).where(User.role == "UNDERWRITER")))
    send(session, recipients, kind="MESSAGE", title="Вопрос клиента в чате", text=preview[:200],
         application_id=application.id)
