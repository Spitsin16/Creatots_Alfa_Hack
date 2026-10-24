"""Outbox worker for the automatic credit-decision pipeline."""

import os
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import make_session_factory
from app.models import Application, AuditLog, Business, Contract, Decision, Outbox, PreOffer, Rule
from app.services.application_flow import transition_application
from app.services.documents.storage import store_signed_contract
from app.services.expiry import expire_offers
from app.services.explain.llm import rephrase
from app.services.explain.templates import facts_for_llm
from app.services.integrations.external import FetchResult, fetch_all
from app.services.sla_sweep import release_overdue


def _decision_text(result: dict, requested_rub: float | None = None) -> str:
    amount = round((result.get("limit") or 0))
    if result["outcome"] == "APPROVED":
        granted = round(min(requested_rub, amount)) if requested_rub else amount
        return f"Одобрено: {granted:,} ₽ — ровно запрошенная сумма. Подпишите договор кодом.".replace(",", " ")
    if result["outcome"] == "COUNTER_OFFER":
        return f"Доступна меньшая сумма — до {amount:,} ₽.".replace(",", " ")
    if result["outcome"] == "MANUAL_REVIEW":
        return "Заявка передана специалисту банка. Решение появится в течение рабочего дня."
    return "Сейчас предложение недоступно. Рекомендации помогут подготовиться к повторной заявке."


def _enrich(session: Session, application: Application) -> FetchResult | None:
    """Запрос внешних источников через сервис mocks (если задан MOCKS_URL).

    Ретраи внутри клиента; недоступный источник не роняет конвейер, а уводит
    заявку в ручную проверку с пометкой «источник недоступен» (ТЗ раздел 12).
    """
    base_url = os.environ.get("MOCKS_URL")
    if not base_url:
        return None
    business = session.get(Business, application.business_id)
    return fetch_all(business.inn, base_url=base_url)


def _explain_pre_offer(session: Session, pre_offer_id: str) -> None:
    """Текст от LLM подменяет шаблон, когда готов; при любой проблеме остаётся шаблон."""
    pre_offer = session.get(PreOffer, pre_offer_id)
    if pre_offer is None or not (pre_offer.explanation or {}).get("decision_snapshot"):
        return
    rule = session.get(Rule, pre_offer.rules_version)
    facts = facts_for_llm(pre_offer.explanation["decision_snapshot"], yaml.safe_load(rule.yaml))
    result = rephrase(facts)
    pre_offer.explanation = {**pre_offer.explanation, "llm": result}
    session.add(
        AuditLog(
            actor_id=None,
            action="EXPLANATION_GENERATED",
            entity="pre_offer",
            entity_id=pre_offer.id,
            before=None,
            after={"source": result["source"], "reason": result["reason"]},
        )
    )


def process_one(session: Session) -> bool:
    """Process one pending event and commit it with all resulting records."""
    event = session.scalar(
        select(Outbox)
        .where(Outbox.status == "PENDING", Outbox.available_at <= datetime.now(UTC))
        .order_by(Outbox.created_at, Outbox.id)
        .with_for_update(skip_locked=True)
    )
    if event is None:
        return False

    event.status = "PROCESSING"
    event.attempts += 1
    if event.event == "CONTRACT_SIGNED":
        application = session.get(Application, event.payload["application_id"])
        if application is not None and application.status == "CONTRACT_SIGNED":
            transition_application(session, application, "ISSUED", actor_id=None, comment="Средства выданы на счёт")
            contract = session.scalar(select(Contract).where(Contract.application_id == application.id))
            if contract is not None:
                store_signed_contract(session, application, contract)
            session.add(
                AuditLog(
                    actor_id=None,
                    action="CREDIT_ISSUED",
                    entity="application",
                    entity_id=application.id,
                    before={"status": "CONTRACT_SIGNED"},
                    after={"status": "ISSUED"},
                )
            )
        event.status = "DONE"
        session.commit()
        return True
    if event.event == "EXPLAIN_PRE_OFFER":
        _explain_pre_offer(session, event.payload["pre_offer_id"])
        event.status = "DONE"
        session.commit()
        return True
    if event.event != "APPLICATION_SUBMITTED":
        event.status = "FAILED"
        session.commit()
        return True

    application = session.get(Application, event.payload["application_id"])
    if application is None:
        event.status = "FAILED"
        session.commit()
        return True
    if application.status != "SUBMITTED":
        event.status = "DONE"
        session.commit()
        return True

    pre_offer = session.get(PreOffer, application.pre_offer_id)
    result = (pre_offer.explanation if pre_offer else {}).get("decision_snapshot")
    if pre_offer is None or result is None:
        event.status = "PENDING"
        event.available_at = datetime.now(UTC) + timedelta(seconds=min(60, 2**event.attempts))
        session.commit()
        return True

    transition_application(session, application, "VALIDATION", actor_id=None, comment="Заявка принята системой")
    transition_application(session, application, "ENRICHMENT", actor_id=None, comment="Данные проверены")
    fetched = _enrich(session, application)
    explanation_text = _decision_text(result, application.amount_kopecks / 100)
    if fetched is not None:
        session.add(
            AuditLog(
                actor_id=None,
                action="SOURCES_REQUESTED",
                entity="application",
                entity_id=application.id,
                before=None,
                after={"attempts": fetched.attempts, "unavailable": fetched.unavailable,
                       "not_found": fetched.not_found},
            )
        )
        if not fetched.complete:
            result = {**result, "outcome": "MANUAL_REVIEW", "reason": "SOURCE_UNAVAILABLE",
                      "unavailable_sources": fetched.unavailable + fetched.not_found}
            explanation_text = fetched.unavailable_text() or "Часть данных не получена — заявку посмотрит специалист."
    transition_application(session, application, "SCORING", actor_id=None, comment="Выполнен расчёт")
    decision = Decision(
        application_id=application.id,
        rules_version=pre_offer.rules_version,
        score=result["score"],
        cls=result["cls"],
        stop_factors=result.get("stop_factors", []),
        factors=result.get("factors", {}),
        limit_kopecks=round((result.get("limit") or 0) * 100),
        binding_constraint=result.get("binding_constraint"),
        rate=Decimal(str(result["rate"])) if result.get("rate") is not None else None,
        outcome=result["outcome"],
        what_if=result.get("advice", []),
        explanation_text=explanation_text,
        explanation_source="TEMPLATE",
    )
    session.add(decision)
    transition_application(
        session,
        application,
        result["outcome"],
        actor_id=None,
        comment="Автоматическое решение готово",
    )
    session.add(
        AuditLog(
            actor_id=None,
            action="AUTOMATIC_DECISION_CREATED",
            entity="application",
            entity_id=application.id,
            before={"status": "SUBMITTED"},
            after={"status": application.status, "rules_version": pre_offer.rules_version},
        )
    )
    event.status = "DONE"
    session.commit()
    return True


def main() -> None:
    factory = make_session_factory()
    last_sweep = 0.0
    while True:
        with factory() as session:
            processed = process_one(session)
            if time.monotonic() - last_sweep > 60:
                release_overdue(session)
                expire_offers(session)
                session.commit()
                last_sweep = time.monotonic()
        if not processed:
            time.sleep(1)


if __name__ == "__main__":
    main()
