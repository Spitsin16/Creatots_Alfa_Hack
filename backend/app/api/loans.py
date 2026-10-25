"""График платежей выданного кредита — один расчёт для кабинета кредита и для договора."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Application, Contract, DataSnapshot, Decision, PreOffer, Rule
from app.services.scoring.engine import derive
from app.services.seasonal.schedule import annuity_schedule
from app.services.seasonal.schedule import build as build_seasonal


@dataclass
class LoanTerms:
    amount: float
    rate: float
    signed: datetime
    first_payment: date | None
    seasonal: bool
    schedule: dict | None        # формат annuity_schedule / build_seasonal; None для овердрафта
    snapshot: dict
    fixture: dict


def first_payment(signed: datetime) -> date:
    d = signed.date()
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return date(y, m, 1)


def latest_decision(session: Session, application_id: str) -> Decision | None:
    return session.scalar(select(Decision).where(Decision.application_id == application_id)
                          .order_by(Decision.created_at.desc(), Decision.id.desc()))


def loan_terms(session: Session, application: Application) -> LoanTerms:
    contract = session.scalar(select(Contract).where(Contract.application_id == application.id))
    decision = latest_decision(session, application.id)
    pre_offer = session.get(PreOffer, application.pre_offer_id)
    explanation = (pre_offer.explanation or {}) if pre_offer else {}
    snapshot = explanation.get("decision_snapshot") or {}
    scenario = explanation.get("scenario") or {}
    rate = float(decision.rate) if decision and decision.rate is not None else 0.0
    amount = application.amount_kopecks / 100
    signed = contract.signed_at if contract else datetime.now(UTC)
    if signed.tzinfo is None:
        signed = signed.replace(tzinfo=UTC)
    snaps = {s.source.lower(): s.payload for s in
             session.scalars(select(DataSnapshot).where(DataSnapshot.business_id == application.business_id))}
    fixture = {"persona": snaps.get("profile", {}),
               **{k: snaps[k] for k in ("alfa", "registry", "fns", "bki") if k in snaps}}
    if application.product == "OVERDRAFT":
        return LoanTerms(amount, rate, signed, None, False, None, snapshot, fixture)
    first = first_payment(signed)
    rules = yaml.safe_load(session.get(Rule, decision.rules_version).yaml) if decision else None
    seasonal = bool(snapshot.get("seasonal_available") and scenario.get("repayment") == "seasonal" and rules
                    and "alfa" in fixture)
    if seasonal:
        d = derive(fixture)
        sched = build_seasonal(amount, rate, application.term_months, d["months"], d["monthly_revenue"], first, rules)
    else:
        sched = annuity_schedule(amount, rate, application.term_months, first)
    return LoanTerms(amount, rate, signed, first, seasonal, sched, snapshot, fixture)
