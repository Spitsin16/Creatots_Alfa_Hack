"""Песочница проверяющего: свой клиент по параметрам считается тем же движком."""

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.worker import process_one

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from mocks.app import create_app as create_mocks  # noqa: E402


def create(api: TestClient, **params) -> dict:
    r = api.post("/api/v1/sandbox/clients", json=params)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.parametrize(
    "params,outcome,reason",
    [
        ({}, "APPROVED", None),
        ({"age_months": 2}, "REJECTED", "BUSINESS_TOO_YOUNG"),
        (
            {"current_overdue_days": 40, "external_balance": 1_000_000, "external_payment": 80_000},
            "REJECTED",
            "CURRENT_OVERDUE",
        ),
        ({"revenue": 2_000_000, "external_balance": 9_000_000, "external_payment": 900_000}, "COUNTER_OFFER", None),
        (
            {"credit_history": "past_gte30", "alfa_credit": "overdue", "tax_debt": 300_000, "industry": "high"},
            "REJECTED",
            "CLASS_E",
        ),
    ],
)
def test_parameters_drive_the_decision(api: TestClient, params: dict, outcome: str, reason: str | None) -> None:
    res = create(api, **params)
    assert res["preview"]["outcome"] == outcome
    assert res["preview"]["reason"] == reason
    assert res["login"].startswith("sbx") and res["transactions"] > 0


def test_sandbox_client_goes_through_normal_journey(api: TestClient) -> None:
    res = create(api, revenue=1_500_000, seasonality="moderate")
    h = {"Authorization": f"Bearer {res['access_token']}"}
    me = api.get("/api/v1/me", headers=h).json()
    bid = me["businesses"][0]["id"]
    assert bid == res["business"]["id"]
    # вход по логину тоже работает
    assert api.post("/api/v1/auth/login", json={"login": res["login"], "password": "demo"}).status_code == 200
    api.post(f"/api/v1/businesses/{bid}/consents", headers=h, json={"kinds": ["BKI", "FNS"]})
    offer = api.post(
        f"/api/v1/businesses/{bid}/pre-offers",
        headers=h,
        json={"purpose": "inventory", "amount_kopecks": 150_000_000, "term_months": 12},
    ).json()
    assert offer["limit_kopecks"] == round(res["preview"]["limit"] * 100)
    app_id = api.post("/api/v1/applications", headers=h, json={"pre_offer_id": offer["id"]}).json()["id"]
    api.post(f"/api/v1/applications/{app_id}/submit", headers={**h, "Idempotency-Key": app_id})
    with api.app.state.session_factory() as session:
        process_one(session)
    assert api.get(f"/api/v1/applications/{app_id}", headers=h).json()["status"] == "APPROVED"
    assert api.get(f"/api/v1/businesses/{bid}/forecast", headers=h).status_code == 200


def test_invalid_parameters(api: TestClient) -> None:
    r = api.post("/api/v1/sandbox/clients", json={"external_balance": 1_000_000})
    assert r.status_code == 422 and "платёж" in r.json()["message"]
    assert api.post("/api/v1/sandbox/clients", json={"revenue": 10}).status_code == 422


def test_sources_only_for_sandbox(api: TestClient) -> None:
    res = create(api)
    inn = res["business"]["inn"]
    bki = api.get(f"/api/v1/sandbox/sources/{inn}/bki").json()
    assert bki["inn"] == inn and "external" in bki
    p3b = json.loads((ROOT / "data/personas/p3b.json").read_text(encoding="utf-8"))
    assert api.get(f"/api/v1/sandbox/sources/{p3b['registry']['inn']}/bki").status_code == 404


def test_mocks_fall_back_to_sandbox() -> None:
    async def fake(base_url: str, inn: str, source: str):
        return {"inn": inn, "external": []} if inn == "770000000099" else None

    client = TestClient(create_mocks(ROOT / "data", timeout_seconds=0, sandbox_url="http://api", sandbox_fetch=fake))
    assert client.get("/bki/770000000099").json() == {"inn": "770000000099", "external": []}
    assert client.get("/bki/000").status_code == 404
