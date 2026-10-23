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
from app.models import Application, AuditLog, Decision, Membership, PreOffer, User
from app.services.application_flow import transition_application
from app.services.expiry import expire_offers

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
