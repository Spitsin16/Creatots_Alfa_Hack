"""Правки после созвона 24.10: клиент видит свою заявку после повторного входа и кто её ведёт;
в очереди банка — исполнитель и фильтр «мои»."""

from fastapi.testclient import TestClient

from app.worker import process_one
from tests.test_bank_api import create_manual_review, login


def test_client_sees_application_after_relogin(api: TestClient) -> None:
    h = login(api, "p3b")
    assert api.get("/api/v1/applications", headers=h).json() == {"items": [], "active_id": None}
    bid = api.get("/api/v1/me", headers=h).json()["businesses"][0]["id"]
    api.post(f"/api/v1/businesses/{bid}/consents", headers=h, json={"kinds": ["BKI", "FNS"]})
    offer = api.post(
        f"/api/v1/businesses/{bid}/pre-offers",
        headers=h,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    ).json()
    app_id = api.post("/api/v1/applications", headers=h, json={"pre_offer_id": offer["id"]}).json()["id"]
    api.post(f"/api/v1/applications/{app_id}/submit", headers={**h, "Idempotency-Key": app_id})
    with api.app.state.session_factory() as session:
        process_one(session)

    again = login(api, "p3b")  # новый вход — новая сессия
    listing = api.get("/api/v1/applications", headers=again).json()
    assert listing["active_id"] == app_id
    assert listing["items"][0]["status"] == "APPROVED"
    # чужой бизнес заявку не видит
    assert api.get("/api/v1/applications", headers=login(api, "p1a")).json()["items"] == []
    assert api.get(f"/api/v1/applications?business_id={bid}", headers=login(api, "p1a")).status_code == 403


def test_assignee_visible_to_client_and_mine_filter(api: TestClient) -> None:
    app_id, client = create_manual_review(
        api, "p2b", {"purpose": "equipment", "amount_kopecks": 150_000_000, "term_months": 24, "urgency": "planned"}
    )
    assert api.get(f"/api/v1/applications/{app_id}", headers=client).json()["assignee_name"] is None
    uw1, uw2 = login(api, "uw1"), login(api, "uw2")
    api.post(f"/api/v1/bank/applications/{app_id}/assign", headers=uw1)
    assert (
        api.get(f"/api/v1/applications/{app_id}", headers=client).json()["assignee_name"] == "Андеррайтер Смирнова Е."
    )
    mine = api.get("/api/v1/bank/applications?mine=true", headers=uw1).json()["items"]
    assert [i["id"] for i in mine] == [app_id] and mine[0]["assignee_name"] == "Андеррайтер Смирнова Е."
    assert api.get("/api/v1/bank/applications?mine=true", headers=uw2).json()["items"] == []
    card = api.get(f"/api/v1/bank/applications/{app_id}", headers=uw2).json()
    assert card["assignee_name"] == "Андеррайтер Смирнова Е."
