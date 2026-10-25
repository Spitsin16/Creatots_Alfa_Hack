"""Правка ментора 25.10: кредит после кредита.

Выданный в кабинете кредит — уже обязательство клиента. Следующий расчёт должен
видеть его платёж, а предложение, посчитанное до выдачи, — считаться устаревшим.
"""

from fastapi.testclient import TestClient

from app.api.fixtures import load_fixture
from app.models import PreOffer
from app.services.scoring.engine import derive
from app.services.scoring.own_loans import as_alfa_credit, monthly_payment, with_own_loans
from app.worker import process_one
from tests.test_bank_api import login
from tests.test_demo_polish import issue

WC = {"purpose": "inventory", "amount_kopecks": 100_000_000, "term_months": 24}


def _business(api: TestClient, h: dict) -> str:
    bid = api.get("/api/v1/me", headers=h).json()["businesses"][0]["id"]
    api.post(f"/api/v1/businesses/{bid}/consents", headers=h, json={"kinds": ["BKI", "FNS"]})
    return bid


def _offer(api: TestClient, h: dict, bid: str, body: dict) -> dict:
    r = api.post(f"/api/v1/businesses/{bid}/pre-offers", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _apply(api: TestClient, h: dict, offer_id: str) -> str:
    app_id = api.post("/api/v1/applications", headers=h, json={"pre_offer_id": offer_id}).json()["id"]
    api.post(f"/api/v1/applications/{app_id}/submit", headers={**h, "Idempotency-Key": app_id})
    with api.app.state.session_factory() as session:
        process_one(session)
    return app_id


def test_payment_formulas() -> None:
    assert monthly_payment("OVERDRAFT", 240_000, 21.0, 12) == 4_200
    annuity = monthly_payment("WORKING_CAPITAL", 1_200_000, 20.0, 24)
    assert 61_000 < annuity < 61_200
    credit = as_alfa_credit({"application_id": "a1", "product": "WORKING_CAPITAL", "amount": 1_200_000,
                             "rate": 20.0, "term_months": 24, "opened": "2026-10-25"})
    assert credit["status"] == "ACTIVE" and credit["source"] == "CABINET" and credit["monthly_payment"] == annuity
    loan = {"application_id": "a1", "product": "WORKING_CAPITAL", "amount": 1_200_000, "rate": 20.0,
            "term_months": 24, "opened": "2026-10-25"}
    fixture = {"alfa": {"credits": []}}
    once = with_own_loans(fixture, [loan])
    assert fixture["alfa"]["credits"] == []  # исходная фикстура не меняется
    assert len(with_own_loans(once, [loan])["alfa"]["credits"]) == 1  # без дублей


def test_second_loan_sees_the_first(api: TestClient) -> None:
    h = login(api, "p3b")
    bid = _business(api, h)
    before = _offer(api, h, bid, WC)
    first = _apply(api, h, before["id"])
    assert api.get(f"/api/v1/applications/{first}", headers=h).json()["status"] == "APPROVED"

    # пока первая заявка в работе, черновик второй создать можно, а отправить — нет
    other = _offer(api, h, bid, WC)
    draft = api.post("/api/v1/applications", headers=h, json={"pre_offer_id": other["id"]}).json()["id"]
    r = api.post(f"/api/v1/applications/{draft}/submit", headers={**h, "Idempotency-Key": draft})
    assert r.status_code == 409 and r.json()["code"] == "APPLICATION_IN_PROGRESS"
    api.post(f"/api/v1/applications/{draft}/cancel", headers=h, json={})

    issue(api, h, first)

    # предложение, посчитанное до выдачи, устарело
    r = api.post("/api/v1/applications", headers=h, json={"pre_offer_id": before["id"]})
    assert r.status_code == 409 and r.json()["code"] == "PRE_OFFER_STALE"

    after = _offer(api, h, bid, WC)
    assert after["limit_kopecks"] <= before["limit_kopecks"]
    with api.app.state.session_factory() as session:
        snap_before = session.get(PreOffer, before["id"]).explanation
        snap_after = session.get(PreOffer, after["id"]).explanation
        d_now = derive(load_fixture(session, bid))
        d_raw = derive(load_fixture(session, bid, with_loans=False))
    assert snap_after["own_loans"] == [first] and snap_before["own_loans"] == []
    assert d_now["alfa_payments"] > d_raw["alfa_payments"]
    # платёжеспособность (сколько ещё можем дать по свободному потоку) уменьшилась
    cap_before = snap_before["decision_snapshot"]["limit_candidates"]["CAPACITY"]
    assert snap_after["decision_snapshot"]["limit_candidates"]["CAPACITY"] < cap_before
    # новый кредит ещё не «история»: класс клиента от выдачи не улучшается
    assert d_now["alfa_history"] == d_raw["alfa_history"] and d_now["credit_history"] == d_raw["credit_history"]

    # платёж по первому кредиту виден в прогнозе кассового разрыва
    loan = api.get(f"/api/v1/applications/{first}/loan", headers=h).json()
    assert any(r["kind"] == "LOAN" for r in loan["forecast"]["recurring"])
