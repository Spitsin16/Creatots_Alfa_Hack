"""Сборка входа движка из снимков источников + кредиты, выданные в кабинете."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import APIError
from app.models import Application, Contract, DataSnapshot
from app.services.scoring.own_loans import with_own_loans

LOAN_STATUSES = ("CONTRACT_SIGNED", "ISSUED")
# заявка «в работе»: новую по этой организации не создаём, пока не будет решения
IN_PROGRESS = ("AWAITING_SIGNATURE", "SUBMITTED", "VALIDATION", "ENRICHMENT", "SCORING", "MANUAL_REVIEW",
               "INFO_REQUESTED", "APPROVED", "COUNTER_OFFER", "CONTRACT_SIGNED")
REQUIRED = {"profile", "alfa", "registry", "fns", "bki"}


def issued_loans(session: Session, business_id: str, exclude_id: str | None = None) -> list[dict]:
    """Подписанные и выданные у нас кредиты бизнеса — это уже обязательства клиента."""
    rows = session.execute(
        select(Application, Contract)
        .join(Contract, Contract.application_id == Application.id)
        .where(Application.business_id == business_id, Application.status.in_(LOAN_STATUSES))
        .order_by(Contract.signed_at)
    ).all()
    return [
        {"application_id": a.id, "product": a.product, "amount": a.amount_kopecks / 100,
         "rate": (c.schedule or {}).get("rate"), "term_months": a.term_months, "opened": c.signed_at.date().isoformat()}
        for a, c in rows if a.id != exclude_id
    ]


def load_fixture(session: Session, business_id: str, with_loans: bool = True) -> dict:
    snapshots = session.scalars(select(DataSnapshot).where(DataSnapshot.business_id == business_id)).all()
    data = {snapshot.source.lower(): snapshot.payload for snapshot in snapshots}
    if not REQUIRED.issubset(data):
        raise APIError(409, "DATA_INCOMPLETE", "Для расчёта не хватает данных")
    fixture = {"persona": data["profile"], **{k: data[k] for k in ("alfa", "registry", "fns", "bki")}}
    return with_own_loans(fixture, issued_loans(session, business_id)) if with_loans else fixture


def own_loan_ids(fixture: dict) -> list[str]:
    """Какие наши кредиты учтены в расчёте — сохраняем в предложении, чтобы ловить устаревшие."""
    return [c["application_id"] for c in fixture["alfa"].get("credits", []) if c.get("source") == "CABINET"]
