"""Действия клиента по решению: принять или отклонить контрпредложение, отменить заявку.

Плюс демо-инструмент админа «перемотать время» для показа истечения предложений.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_session, require_membership
from app.api.errors import APIError
from app.api.fixtures import issued_loans
from app.api.loans import loan_terms
from app.models import Application, AuditLog, Decision, Membership, PreOffer, User
from app.services.application_flow import transition_application
from app.services.expiry import expire_offers
from app.services.forecast.cashflow import forecast_for_client
from app.services.scoring.own_loans import forecast_payments

router = APIRouter(prefix="/api/v1", tags=["client-actions"])
CANCELLABLE = {"DRAFT", "AWAITING_SIGNATURE", "SUBMITTED", "INFO_REQUESTED", "COUNTER_OFFER"}


def _own(session: Session, user: User, application_id: str, permission: str) -> Application:
    application = session.get(Application, application_id)
    if application is None:
        raise APIError(404, "APPLICATION_NOT_FOUND", "Заявка не найдена")
    require_membership(session, user, application.business_id, permission)
    return application


def _latest(session: Session, application_id: str) -> Decision | None:
    return session.scalar(select(Decision).where(Decision.application_id == application_id)
                          .order_by(Decision.created_at.desc(), Decision.id.desc()))


def counter_terms(session: Session, application: Application) -> dict | None:
    """Условия контрпредложения: от банка (ручное) или из автоматического расчёта (например, рефинансирование)."""
    decision = _latest(session, application.id)
    if decision is None:
        return None
    if decision.decided_by is None:
        pre_offer = session.get(PreOffer, application.pre_offer_id)
        counter = ((pre_offer.explanation or {}).get("decision_snapshot") or {}).get("counter") if pre_offer else None
        if counter:
            return {"product": counter["product"], "amount_kopecks": round(counter["amount"] * 100),
                    "term_months": counter["term"], "rate": counter.get("rate") or (float(decision.rate) if decision.rate else None)}
    return {"product": application.product, "amount_kopecks": decision.limit_kopecks,
            "term_months": application.term_months, "rate": float(decision.rate) if decision.rate is not None else None}


ACTIVE = {"DRAFT", "AWAITING_SIGNATURE", "SUBMITTED", "VALIDATION", "ENRICHMENT", "SCORING", "MANUAL_REVIEW",
          "INFO_REQUESTED", "APPROVED", "COUNTER_OFFER", "CONTRACT_SIGNED"}


@router.get("/applications")
def list_my_applications(business_id: str | None = None, user: User = Depends(get_current_user),
                         session: Session = Depends(get_session)) -> dict:
    """Заявки бизнеса клиента — чтобы после повторного входа он видел свою заявку и решение."""
    memberships = session.scalars(select(Membership).where(Membership.user_id == user.id)).all()
    allowed = {m.business_id for m in memberships if "VIEW" in (m.permissions or [])}
    if business_id:
        if business_id not in allowed:
            raise APIError(403, "BUSINESS_ACCESS_DENIED", "Нет доступа к организации")
        allowed = {business_id}
    if not allowed:
        return {"items": [], "active_id": None}
    apps = session.scalars(select(Application).where(Application.business_id.in_(allowed))
                           .order_by(Application.created_at.desc(), Application.id.desc())).all()
    items = [{"id": a.id, "business_id": a.business_id, "product": a.product, "amount_kopecks": a.amount_kopecks,
              "term_months": a.term_months, "status": a.status, "active": a.status in ACTIVE,
              "created_at": a.created_at} for a in apps]
    active = next((i["id"] for i in items if i["active"]), None)
    return {"items": items, "active_id": active}


@router.get("/applications/{application_id}/counter-offer")
def get_counter_offer(application_id: str, user: User = Depends(get_current_user),
                      session: Session = Depends(get_session)) -> dict:
    application = _own(session, user, application_id, "VIEW")
    if application.status != "COUNTER_OFFER":
        raise APIError(409, "NO_COUNTER_OFFER", "По заявке нет контрпредложения")
    return counter_terms(session, application)


@router.post("/applications/{application_id}/counter-offer/accept")
def accept_counter_offer(application_id: str, user: User = Depends(get_current_user),
                         session: Session = Depends(get_session)) -> dict:
    application = _own(session, user, application_id, "SUBMIT")
    if application.status != "COUNTER_OFFER":
        raise APIError(409, "NO_COUNTER_OFFER", "По заявке нет контрпредложения")
    terms = counter_terms(session, application)
    source = _latest(session, application.id)
    before = {"product": application.product, "amount_kopecks": application.amount_kopecks,
              "term_months": application.term_months}
    application.product = terms["product"]
    application.amount_kopecks = terms["amount_kopecks"]
    application.term_months = terms["term_months"]
    session.add(Decision(
        application_id=application.id, rules_version=source.rules_version, score=source.score, cls=source.cls,
        stop_factors=source.stop_factors, factors=source.factors, limit_kopecks=terms["amount_kopecks"],
        binding_constraint=source.binding_constraint,
        rate=Decimal(str(terms["rate"])) if terms["rate"] is not None else source.rate,
        outcome="APPROVED", what_if=source.what_if, explanation_text="Вы приняли предложение банка",
        explanation_source="TEMPLATE", decided_by=None, created_at=datetime.now(UTC),
    ))
    transition_application(session, application, "APPROVED", actor_id=user.id, comment="Клиент принял предложение банка")
    session.add(AuditLog(actor_id=user.id, action="COUNTER_OFFER_ACCEPTED", entity="application",
                         entity_id=application.id, before=before, after=terms))
    session.commit()
    return {"status": application.status, **terms}


class CancelRequest(BaseModel):
    reason: str = Field(default="", max_length=300)


@router.post("/applications/{application_id}/counter-offer/decline")
def decline_counter_offer(application_id: str, payload: CancelRequest, user: User = Depends(get_current_user),
                          session: Session = Depends(get_session)) -> dict:
    application = _own(session, user, application_id, "SUBMIT")
    if application.status != "COUNTER_OFFER":
        raise APIError(409, "NO_COUNTER_OFFER", "По заявке нет контрпредложения")
    transition_application(session, application, "CANCELLED", actor_id=user.id,
                           comment="Клиент отклонил предложение банка")
    session.add(AuditLog(actor_id=user.id, action="COUNTER_OFFER_DECLINED", entity="application",
                         entity_id=application.id, before={"status": "COUNTER_OFFER"},
                         after={"status": "CANCELLED", "reason": payload.reason}))
    session.commit()
    return {"status": application.status}


@router.post("/applications/{application_id}/cancel")
def cancel_application(application_id: str, payload: CancelRequest, user: User = Depends(get_current_user),
                       session: Session = Depends(get_session)) -> dict:
    application = _own(session, user, application_id, "SUBMIT")
    if application.status not in CANCELLABLE:
        raise APIError(409, "CANNOT_CANCEL", "Заявку на этом этапе отменить нельзя")
    previous = application.status
    transition_application(session, application, "CANCELLED", actor_id=user.id, comment="Клиент отменил заявку")
    session.add(AuditLog(actor_id=user.id, action="APPLICATION_CANCELLED", entity="application",
                         entity_id=application.id, before={"status": previous},
                         after={"status": "CANCELLED", "reason": payload.reason}))
    session.commit()
    return {"status": application.status}


class TimeTravelRequest(BaseModel):
    days: int = Field(default=31, ge=1, le=365)


@router.post("/bank/admin/time-travel")
def time_travel(payload: TimeTravelRequest, user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> dict:
    """Демо: «перемотать время» — истекают одобрения, которые были бы просрочены через N дней."""
    if user.role != "RULES_ADMIN":
        raise APIError(403, "ROLE_DENIED", "Только администратор")
    expired = expire_offers(session, now=datetime.now(UTC) + timedelta(days=payload.days))
    session.add(AuditLog(actor_id=user.id, action="DEMO_TIME_TRAVEL", entity="system", entity_id="clock",
                         before=None, after={"days": payload.days, "expired": expired}))
    session.commit()
    return {"days": payload.days, "expired": expired}


@router.get("/applications/{application_id}/loan")
def loan_cabinet(application_id: str, user: User = Depends(get_current_user),
                 session: Session = Depends(get_session)) -> dict:
    """Кабинет после выдачи: кредит, ближайший платёж, график (сезонный, если выбран), прогноз разрыва."""
    application = _own(session, user, application_id, "VIEW")
    if application.status != "ISSUED":
        raise APIError(409, "LOAN_NOT_ISSUED", "Кредит ещё не выдан")
    terms = loan_terms(session, application)
    rate, amount, signed, snapshot, fixture = terms.rate, terms.amount, terms.signed, terms.snapshot, terms.fixture
    tips: list[str] = []
    result = {
        "product": application.product, "amount": round(amount), "rate": rate, "term_months": application.term_months,
        "signed_at": signed.isoformat(), "seasonal": False, "schedule": [], "next_payment": None,
        "overpayment": None, "tips": tips, "forecast": None,
    }
    if application.product == "OVERDRAFT":
        result["forecast"] = forecast_for_client(
            fixture, overdraft_limit=amount,
            extra_recurring=forecast_payments(issued_loans(session, application.business_id)),
        ) if "alfa" in fixture else None
        tips.append("Овердрафт включается сам, когда на счёте не хватает денег, и гасится первыми поступлениями.")
        tips.append(f"Проценты — только за дни использования: 100 000 ₽ на 10 дней ≈ "
                    f"{round(100_000 * rate / 100 * 10 / 365):,} ₽.".replace(",", " "))
        if result["forecast"] and result["forecast"]["gap"]:
            g = result["forecast"]["gap"]
            tips.append(f"По прогнозу {g['date'][8:10]}.{g['date'][5:7]} не хватит {g['shortfall']:,} ₽ — "
                        f"овердрафт закроет разрыв автоматически.".replace(",", " "))
        return result
    first, use_seasonal, sched = terms.first_payment, terms.seasonal, terms.schedule
    months = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре",
              "ноябре", "декабре"]
    if use_seasonal:
        if sched["peak_months"]:
            tips.append("В сезон платёж выше: " + ", ".join(months[m - 1] for m in sched["peak_months"]) + " — "
                        "выручка в эти месяцы больше.")
        if sched["low_months"]:
            tips.append("В слабые месяцы платёж минимальный: " + ", ".join(months[m - 1] for m in sched["low_months"]) + ".")
    elif snapshot.get("seasonal_available"):
        tips.append("У бизнеса сезонная выручка — можно перейти на сезонный график: в сезон больше, в межсезонье меньше.")
    result.update(seasonal=use_seasonal, schedule=sched["schedule"], next_payment=sched["schedule"][0],
                  overpayment=sched["overpayment"], max_payment=sched["max_payment"], min_payment=sched["min_payment"])
    if "alfa" in fixture:
        result["forecast"] = forecast_for_client(
            fixture, extra_recurring=forecast_payments(issued_loans(session, application.business_id)))
        g = result["forecast"]["gap"]
        if g:
            tips.append(f"Кассовый разрыв {g['date'][8:10]}.{g['date'][5:7]} на {g['shortfall']:,} ₽ — подключите "
                        f"овердрафт, чтобы не сорвать платёж по кредиту.".replace(",", " "))
    tips.append(f"Ближайший платёж {sched['schedule'][0]['payment']:,} ₽ спишется со счёта "
                f"{first.strftime('%d.%m.%Y')} — держите деньги на счёте накануне.".replace(",", " "))
    return result
