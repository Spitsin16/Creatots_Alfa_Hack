"""Ассистент: POST /assistant/messages — ответ по данным клиента, без решений и подачи заявок."""

import yaml
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_session, require_membership
from app.api.errors import APIError
from app.api.insights import _fixture
from app.models import Application, AuditLog, Membership, PreOffer, Rule, User
from app.services.assistant import SUGGESTED, answer
from app.services.explain.templates import explain_for_client
from app.services.forecast.cashflow import forecast_for_client

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])


class AskIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    business_id: str | None = None


def _business(session: Session, user: User, business_id: str | None) -> str:
    if business_id:
        require_membership(session, user, business_id, "VIEW")
        return business_id
    membership = session.scalar(select(Membership).where(Membership.user_id == user.id))
    if membership is None:
        raise APIError(403, "ROLE_DENIED", "Ассистент доступен клиентам")
    return membership.business_id


@router.get("/suggestions")
def suggestions() -> dict:
    return {"items": SUGGESTED}


@router.post("/messages")
def ask(payload: AskIn, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    business_id = _business(session, user, payload.business_id)
    pre_offer = session.scalar(select(PreOffer).where(PreOffer.business_id == business_id)
                               .order_by(PreOffer.expires_at.desc()))
    application = session.scalar(select(Application).where(Application.business_id == business_id)
                                 .order_by(Application.created_at.desc(), Application.id.desc()))
    explanation = offer = None
    if pre_offer and (pre_offer.explanation or {}).get("decision_snapshot"):
        snap = pre_offer.explanation["decision_snapshot"]
        rule = session.get(Rule, pre_offer.rules_version)
        explanation = explain_for_client(snap, yaml.safe_load(rule.yaml))
        offer = {"limit": snap.get("limit"), "rate": snap.get("rate"), "payment": snap.get("payment"),
                 "term": snap.get("term"), "product": snap.get("product"), "overpayment": snap.get("overpayment")}
    try:
        fixture = _fixture(session, business_id)
        overdraft = offer["limit"] if offer and offer.get("product") == "OVERDRAFT" else None
        forecast = forecast_for_client(fixture, overdraft_limit=overdraft)
    except APIError:
        forecast = None
    result = answer(payload.text, explanation=explanation, offer=offer, forecast=forecast,
                    application={"status": application.status} if application else None)
    session.add(AuditLog(actor_id=user.id, action="ASSISTANT_ASKED", entity="business", entity_id=business_id,
                         before=None, after={"intent": result["intent"]}))
    session.commit()
    return {**result, "source": "TEMPLATE"}
