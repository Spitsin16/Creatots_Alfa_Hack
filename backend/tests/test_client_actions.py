"""Контрпредложение (принять / отклонить), отмена заявки, истечение одобрений."""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Decision
from app.worker import process_one
from tests.test_bank_api import login


def submitted(api: TestClient, username: str, payload: dict) -> tuple[dict[str, str], str]:
    h = login(api, username)
    bid = api.get("/api/v1/me", headers=h).json()["businesses"][0]["id"]
    api.post(f"/api/v1/businesses/{bid}/consents", headers=h, json={"kinds": ["BKI", "FNS"]})
    offer = api.post(f"/api/v1/businesses/{bid}/pre-offers", headers=h, json=payload).json()
    app_id = api.post("/api/v1/applications", headers=h, json={"pre_offer_id": offer["id"]}).json()["id"]
    api.post(f"/api/v1/applications/{app_id}/submit", headers={**h, "Idempotency-Key": app_id})
    with api.app.state.session_factory() as session:
        process_one(session)
    return h, app_id


P2B = {"purpose": "equipment", "amount_kopecks": 150_000_000, "term_months": 24, "urgency": "planned"}
P3B = {"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"}


def counter_offered(api: TestClient) -> tuple[dict[str, str], str]:
    h, app_id = submitted(api, "p2b", P2B)
    assert api.get(f"/api/v1/applications/{app_id}", headers=h).json()["status"] == "MANUAL_REVIEW"
    uw = login(api, "uw1")
    api.post(f"/api/v1/bank/applications/{app_id}/assign", headers=uw)
    r = api.post(
        f"/api/v1/bank/applications/{app_id}/actions",
        headers=uw,
        json={"action": "COUNTER_OFFER", "comment": "Можем меньшую сумму", "amount_kopecks": 100_000_000},
    )
    assert r.status_code == 200 and r.json()["status"] == "COUNTER_OFFER", r.text
    return h, app_id


def test_client_accepts_bank_counter_offer_and_signs(api: TestClient) -> None:
    h, app_id = counter_offered(api)
    terms = api.get(f"/api/v1/applications/{app_id}/counter-offer", headers=h).json()
    assert terms["amount_kopecks"] == 100_000_000 and terms["product"] == "WORKING_CAPITAL" and terms["rate"] == 24.0
    r = api.post(f"/api/v1/applications/{app_id}/counter-offer/accept", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "APPROVED"
    assert api.get(f"/api/v1/applications/{app_id}", headers=h).json()["amount_kopecks"] == 100_000_000
    assert api.post(f"/api/v1/applications/{app_id}/sign", headers=h, json={"code": "0000"}).status_code == 200
    with api.app.state.session_factory() as session:
        assert (
            session.scalars(select(Decision).where(Decision.application_id == app_id)).all()[-1].outcome == "APPROVED"
        )


def test_decline_counter_offer_cancels(api: TestClient) -> None:
    h, app_id = counter_offered(api)
    r = api.post(f"/api/v1/applications/{app_id}/counter-offer/decline", headers=h, json={"reason": "мало"})
    assert r.json()["status"] == "CANCELLED"
    assert api.post(f"/api/v1/applications/{app_id}/counter-offer/accept", headers=h).status_code == 409


def test_cancel_rules(api: TestClient) -> None:
    h, app_id = submitted(api, "p3b", P3B)  # уже APPROVED
    assert api.post(f"/api/v1/applications/{app_id}/cancel", headers=h, json={}).status_code == 409
    h = login(api, "p3b")
    bid = api.get("/api/v1/me", headers=h).json()["businesses"][0]["id"]
    offer = api.post(f"/api/v1/businesses/{bid}/pre-offers", headers=h, json=P3B).json()
    draft = api.post("/api/v1/applications", headers=h, json={"pre_offer_id": offer["id"]}).json()["id"]
    assert api.post(f"/api/v1/applications/{draft}/cancel", headers=h, json={}).json()["status"] == "CANCELLED"
    # бухгалтер по МЧД без права SUBMIT отменить не может
    acc = login(api, "p3a_acc")
    assert api.post(f"/api/v1/applications/{app_id}/cancel", headers=acc, json={}).status_code == 403


def test_time_travel_expires_unsigned_approval(api: TestClient) -> None:
    h, app_id = submitted(api, "p3b", P3B)
    admin = login(api, "admin1")
    assert api.post("/api/v1/bank/admin/time-travel", headers=admin, json={"days": 10}).json()["expired"] == []
    r = api.post("/api/v1/bank/admin/time-travel", headers=admin, json={"days": 31})
    assert r.json()["expired"] == [app_id]
    assert api.get(f"/api/v1/applications/{app_id}", headers=h).json()["status"] == "EXPIRED"
    assert api.post(f"/api/v1/applications/{app_id}/sign", headers=h, json={"code": "0000"}).status_code == 409
    assert api.post("/api/v1/bank/admin/time-travel", headers=login(api, "uw1"), json={"days": 31}).status_code == 403
