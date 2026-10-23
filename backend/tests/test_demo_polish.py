"""Демо 24.10 (вторая волна): уведомления сотрудникам, счётчики для переключателя, кабинет после выдачи."""

from fastapi.testclient import TestClient

from app.worker import process_one
from tests.test_bank_api import create_manual_review, login


def unread(api: TestClient, *logins: str) -> dict:
    return api.get(f"/api/v1/demo/unread?logins={','.join(logins)}").json()["unread"]


def issue(api: TestClient, h: dict, app_id: str) -> None:
    assert api.post(f"/api/v1/applications/{app_id}/sign", headers=h, json={"code": "0000"}).status_code == 200
    with api.app.state.session_factory() as session:
        process_one(session)
    assert api.get(f"/api/v1/applications/{app_id}", headers=h).json()["status"] == "ISSUED"


def test_staff_notified_and_switcher_counts(api: TestClient) -> None:
    before = unread(api, "uw1", "uw2", "risk1", "admin1")
    assert before == {"uw1": 0, "uw2": 0, "risk1": 0, "admin1": 0}
    app_id, client = create_manual_review(
        api,
        "p3a",
        {
            "purpose": "refinance",
            "amount_kopecks": 550_000_000,
            "term_months": 48,
            "repayment": "seasonal",
            "assets": ["real_estate"],
        },
    )
    after = unread(api, "uw1", "uw2", "risk1")
    assert after["uw1"] >= 1 and after["uw2"] >= 1 and after["risk1"] == 0
    uw = login(api, "uw1")
    api.post(f"/api/v1/bank/applications/{app_id}/assign", headers=uw)
    r = api.post(f"/api/v1/bank/applications/{app_id}/actions", headers=uw, json={"action": "APPROVE", "comment": "Документы в порядке"})
    assert r.json()["risk_required"] is True
    assert unread(api, "risk1")["risk1"] == 1
    titles = [n["title"] for n in api.get("/api/v1/notifications", headers=login(api, "risk1")).json()["items"]]
    assert titles == ["Нужно второе одобрение"]
    # неизвестные логины просто не попадают в ответ
    assert unread(api, "nobody") == {}

    risk = login(api, "risk1")
    approval = api.get("/api/v1/bank/approvals", headers=risk).json()[0]["approval_id"]
    api.post(f"/api/v1/bank/approvals/{approval}", headers=risk, json={"action": "APPROVE", "comment": "Согласовано"})
    issue(api, client, app_id)
    loan = api.get(f"/api/v1/applications/{app_id}/loan", headers=client).json()
    assert loan["product"] == "REFINANCE" and loan["seasonal"] is True
    assert len(loan["schedule"]) == 48 and loan["schedule"][-1]["balance"] == 0
    assert loan["max_payment"] > loan["min_payment"]
    assert any("сезон" in t for t in loan["tips"])


def test_overdraft_loan_cabinet(api: TestClient) -> None:
    h = login(api, "p3b")
    bid = api.get("/api/v1/me", headers=h).json()["businesses"][0]["id"]
    api.post(f"/api/v1/businesses/{bid}/consents", headers=h, json={"kinds": ["BKI", "FNS"]})
    offer = api.post(
        f"/api/v1/businesses/{bid}/pre-offers",
        headers=h,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    ).json()
    app_id = api.post("/api/v1/applications", headers=h, json={"pre_offer_id": offer["id"]}).json()["id"]
    assert api.get(f"/api/v1/applications/{app_id}/loan", headers=h).status_code == 409
    api.post(f"/api/v1/applications/{app_id}/submit", headers={**h, "Idempotency-Key": app_id})
    with api.app.state.session_factory() as session:
        process_one(session)
    issue(api, h, app_id)
    loan = api.get(f"/api/v1/applications/{app_id}/loan", headers=h).json()
    assert loan["product"] == "OVERDRAFT" and loan["amount"] == 240_000
    assert loan["forecast"]["gap"]["shortfall"] == 211_060
    assert any("закроет разрыв" in t for t in loan["tips"])
    assert api.get(f"/api/v1/applications/{app_id}/loan", headers=login(api, "p1a")).status_code == 403


def test_annuity_loan_for_regular_credit(api: TestClient) -> None:
    app_id, client = create_manual_review(
        api, "p2b", {"purpose": "equipment", "amount_kopecks": 100_000_000, "term_months": 24, "urgency": "planned"}
    )
    uw = login(api, "uw1")
    api.post(f"/api/v1/bank/applications/{app_id}/assign", headers=uw)
    r = api.post(
        f"/api/v1/bank/applications/{app_id}/actions",
        headers=uw,
        json={"action": "COUNTER_OFFER", "comment": "Меньше", "amount_kopecks": 80_000_000},
    )
    assert r.status_code == 200
    api.post(f"/api/v1/applications/{app_id}/counter-offer/accept", headers=client)
    issue(api, client, app_id)
    loan = api.get(f"/api/v1/applications/{app_id}/loan", headers=client).json()
    assert loan["seasonal"] is False and loan["amount"] == 800_000
    assert len(loan["schedule"]) == 24 and loan["next_payment"]["payment"] > 0
