"""Клиентские «умные» эндпоинты поверх сервисов движка.

- объяснение предложения словами («почему такая сумма», «как получить больше»);
- выписка 1С из другого банка → пересчёт предложения (совет UPLOAD_STATEMENT);
- сезонный график платежей;
- прогноз кассового разрыва на 30 дней.

Вся логика — в `app/services/*` (чистые функции); здесь только доступ, БД и аудит.
"""

import os
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import yaml
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_session, require_membership
from app.api.errors import APIError
from app.api.fixtures import issued_loans, load_fixture, own_loan_ids
from app.models import AuditLog, Outbox, PreOffer, Rule, Statement, User
from app.services.explain.llm import configured as llm_configured
from app.services.explain.templates import explain_for_client
from app.services.forecast.cashflow import forecast_for_client
from app.services.scoring.engine import decide, derive
from app.services.scoring.own_loans import forecast_payments
from app.services.seasonal.schedule import build as build_seasonal
from app.services.statement_1c.parser import MAX_FILE_BYTES, StatementError, extra_revenue_for_scoring

router = APIRouter(prefix="/api/v1", tags=["insights"])

MONTHLY_PRODUCTS = {"WORKING_CAPITAL", "CREDIT_LINE", "REFINANCE"}


def _today() -> date:
    return date.fromisoformat(os.environ.get("DEMO_TODAY", "2026-10-22"))


def _fixture(session: Session, business_id: str) -> dict:
    return load_fixture(session, business_id)


def _pre_offer(session: Session, user: User, pre_offer_id: str, permission: str = "VIEW") -> PreOffer:
    pre_offer = session.get(PreOffer, pre_offer_id)
    if pre_offer is None:
        raise APIError(404, "PRE_OFFER_NOT_FOUND", "Предложение не найдено")
    require_membership(session, user, pre_offer.business_id, permission)
    return pre_offer


def _snapshot(pre_offer: PreOffer) -> dict:
    snapshot = (pre_offer.explanation or {}).get("decision_snapshot")
    if snapshot is None:
        raise APIError(409, "DECISION_MISSING", "Для предложения нет расчёта")
    return snapshot


def _rules(session: Session, version: int) -> dict:
    rule = session.get(Rule, version)
    if rule is None:
        raise APIError(503, "RULES_UNAVAILABLE", "Правила расчёта временно недоступны")
    return yaml.safe_load(rule.yaml)


@router.get("/pre-offers/{pre_offer_id}/explanation")
def pre_offer_explanation(
    pre_offer_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    """Текст для экрана предложения: без баллов, класса и антифрода."""
    pre_offer = _pre_offer(session, user, pre_offer_id)
    snapshot = _snapshot(pre_offer)
    fixture = _fixture(session, pre_offer.business_id)
    context = {"days": fixture["bki"].get("current_overdue_days", "")}
    result = explain_for_client(snapshot, _rules(session, pre_offer.rules_version), context)
    llm = (pre_offer.explanation or {}).get("llm") or {}
    result["summary"] = llm.get("text")
    result["source"] = "LLM" if llm.get("text") else "TEMPLATE"
    result["statement_applied"] = bool((pre_offer.explanation or {}).get("statement_id"))
    return result


@router.get("/pre-offers/{pre_offer_id}/seasonal-schedule")
def seasonal_schedule(
    pre_offer_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    pre_offer = _pre_offer(session, user, pre_offer_id)
    snapshot = _snapshot(pre_offer)
    if not snapshot.get("seasonal_available") or pre_offer.product not in MONTHLY_PRODUCTS:
        raise APIError(409, "SEASONAL_NOT_AVAILABLE", "Для этого предложения сезонный график не нужен")
    rate = float(pre_offer.rate) if pre_offer.rate is not None else None
    amount = min(pre_offer.amount_kopecks, pre_offer.limit_kopecks or pre_offer.amount_kopecks) / 100
    if rate is None or amount <= 0:
        raise APIError(409, "SEASONAL_NOT_AVAILABLE", "Для этого предложения сезонный график не нужен")
    d = derive(_fixture(session, pre_offer.business_id))
    today = _today()
    first_payment = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    result = build_seasonal(
        amount,
        rate,
        pre_offer.term_months,
        d["months"],
        d["monthly_revenue"],
        first_payment,
        _rules(session, pre_offer.rules_version),
    )
    result["amount"] = round(amount)
    result["rate"] = rate
    result["term_months"] = pre_offer.term_months
    return result


@router.get("/businesses/{business_id}/forecast")
def cash_gap_forecast(
    business_id: str,
    overdraft_limit_kopecks: int | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    """Прогноз остатка на 30 дней и ближайший кассовый разрыв."""
    require_membership(session, user, business_id, "VIEW")
    limit = overdraft_limit_kopecks / 100 if overdraft_limit_kopecks else None
    # платежи по кредитам, выданным в кабинете, — тоже регулярные списания (в снимке счёта их ещё нет)
    return forecast_for_client(_fixture(session, business_id), overdraft_limit=limit,
                               extra_recurring=forecast_payments(issued_loans(session, business_id)))


@router.post("/pre-offers/{pre_offer_id}/statement", status_code=201)
async def upload_statement(
    pre_offer_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    """Тело запроса — файл выписки 1С как есть (application/octet-stream).

    Ответ: сводка по выписке и новое предложение, пересчитанное с выручкой из другого банка.
    """
    pre_offer = _pre_offer(session, user, pre_offer_id, "FILL")
    _snapshot(pre_offer)
    scenario = (pre_offer.explanation or {}).get("scenario")
    if scenario is None:
        raise APIError(409, "SCENARIO_MISSING", "Пересчитайте предложение заново и загрузите выписку")
    raw = await request.body()
    if len(raw) > MAX_FILE_BYTES:
        raise APIError(413, "FILE_TOO_LARGE", "Файл больше 5 МБ")
    fixture = _fixture(session, pre_offer.business_id)
    try:
        parsed = extra_revenue_for_scoring(raw, fixture["registry"]["inn"], _today())
    except StatementError as exc:
        statement = Statement(
            business_id=pre_offer.business_id,
            file_id=str(uuid4()),
            period_from=_today(),
            period_to=_today(),
            months={},
            valid=False,
            errors=[{"code": exc.code, "message": exc.message}],
        )
        session.add(statement)
        session.commit()
        raise APIError(422, f"STATEMENT_{exc.code}", exc.message) from exc

    statement = Statement(
        business_id=pre_offer.business_id,
        file_id=str(uuid4()),
        period_from=date.fromisoformat(parsed["period"][0]),
        period_to=date.fromisoformat(parsed["period"][1]),
        months={m["month"]: m["revenue_kop"] for m in parsed["monthly"]},
        valid=True,
        errors=parsed["warnings"],
    )
    session.add(statement)
    session.flush()

    rules = _rules(session, pre_offer.rules_version)
    try:
        result = decide(rules, fixture, extra_statement_revenue=parsed["extra_statement_revenue"], scenario=scenario)
    except (KeyError, TypeError, ValueError) as exc:
        raise APIError(422, "UNSUPPORTED_SCENARIO", "Такой сценарий пока не поддерживается") from exc
    advice = [
        {
            "code": a["code"],
            "text": a["text"],
            "new_limit_kopecks": round(a["new_limit"] * 100),
            "new_rate": a.get("new_rate"),
        }
        for a in result.get("advice", [])
        if a["code"] != "UPLOAD_STATEMENT"
    ]
    result["advice"] = [a for a in result.get("advice", []) if a["code"] != "UPLOAD_STATEMENT"]
    new_offer = PreOffer(
        business_id=pre_offer.business_id,
        rules_version=pre_offer.rules_version,
        purpose=pre_offer.purpose,
        amount_kopecks=pre_offer.amount_kopecks,
        term_months=result["term"],
        product=result["product"],
        limit_kopecks=round((result.get("limit") or 0) * 100),
        rate=Decimal(str(result["rate"])) if result.get("rate") is not None else None,
        payment_kopecks=round(result["payment"] * 100) if result.get("payment") is not None else None,
        explanation={
            "outcome": result["outcome"],
            "advice": advice,
            "decision_snapshot": result,
            "scenario": scenario,
            "own_loans": own_loan_ids(fixture),
            "statement_id": statement.id,
            "previous_pre_offer_id": pre_offer.id,
        },
        expires_at=datetime.now(UTC) + timedelta(days=30),
    )
    session.add(new_offer)
    session.flush()
    if llm_configured():
        session.add(Outbox(event="EXPLAIN_PRE_OFFER", payload={"pre_offer_id": new_offer.id}))
    session.add(
        AuditLog(
            actor_id=user.id,
            action="STATEMENT_APPLIED",
            entity="pre_offer",
            entity_id=new_offer.id,
            before={"pre_offer_id": pre_offer.id, "limit_kopecks": pre_offer.limit_kopecks},
            after={
                "statement_id": statement.id,
                "limit_kopecks": new_offer.limit_kopecks,
                "rules_version": pre_offer.rules_version,
            },
        )
    )
    session.commit()
    return {
        "statement": {
            "id": statement.id,
            "period": parsed["period"],
            "full_months": parsed["full_months"],
            "avg_revenue_kopecks": round(parsed["extra_statement_revenue"] * 100),
            "monthly": parsed["monthly"],
            "warnings": parsed["warnings"],
        },
        "previous_limit_kopecks": pre_offer.limit_kopecks,
        "pre_offer": {
            "id": new_offer.id,
            "business_id": new_offer.business_id,
            "outcome": result["outcome"],
            "product": new_offer.product,
            "requested_amount_kopecks": new_offer.amount_kopecks,
            "limit_kopecks": new_offer.limit_kopecks,
            "rate": float(new_offer.rate) if new_offer.rate is not None else None,
            "payment_kopecks": new_offer.payment_kopecks,
            "term_months": new_offer.term_months,
            "advice": advice,
            "expires_at": new_offer.expires_at.isoformat(),
        },
    }
