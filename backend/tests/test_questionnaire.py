"""Анкета (ТЗ 5.2): коды ответов как в rules.yaml; API даёт тот же исход, что эталон."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

DATA = Path(__file__).resolve().parents[2] / "data"
EXPECTED = json.loads((DATA / "reference/expected.json").read_text(encoding="utf-8"))


def login(api: TestClient, username: str) -> tuple[dict[str, str], str]:
    token = api.post("/api/v1/auth/login", json={"login": username, "password": "demo"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return headers, api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]


def scenario_payload(scenario: dict) -> dict:
    return {
        "purpose": scenario["purpose"],
        "amount_kopecks": round(scenario["amount"] * 100),
        "term_months": scenario["term_months"],
        "frequency": scenario["frequency"],
        "urgency": scenario["urgency"],
        "priority": scenario["priority"],
        "repayment": scenario["repayment"],
        "assets": scenario["assets"],
    }


@pytest.mark.parametrize("pid", sorted(EXPECTED))
def test_every_persona_scenario_through_api_matches_reference(api: TestClient, pid: str) -> None:
    persona = json.loads((DATA / f"personas/{pid}.json").read_text(encoding="utf-8"))
    headers, business_id = login(api, persona["persona"]["login"])
    response = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json=scenario_payload(persona["persona"]["scenario"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["outcome"] == EXPECTED[pid]["outcome"]
    assert body["product"] == EXPECTED[pid]["product"]
    assert body["limit_kopecks"] == pytest.approx(round(EXPECTED[pid]["limit"] * 100), abs=1_000_000)


def test_several_per_year_gives_credit_line(api: TestClient) -> None:
    headers, business_id = login(api, "p1a")
    response = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json={
            "purpose": "inventory",
            "amount_kopecks": 200_000_000,
            "term_months": 12,
            "frequency": "several_per_year",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["product"] == "CREDIT_LINE"


@pytest.mark.parametrize(
    "field,value",
    [("frequency", "sometimes"), ("priority", "speed"), ("purpose", "yacht"), ("assets", ["gold"])],
)
def test_unknown_answer_codes_are_rejected(api: TestClient, field: str, value) -> None:
    headers, business_id = login(api, "p1a")
    payload = {"purpose": "inventory", "amount_kopecks": 200_000_000, "term_months": 12, field: value}
    response = api.post(f"/api/v1/businesses/{business_id}/pre-offers", headers=headers, json=payload)
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_seasonal_and_bullet_repayment_accepted(api: TestClient) -> None:
    headers, business_id = login(api, "p1a")
    for repayment in ("seasonal", "bullet"):
        response = api.post(
            f"/api/v1/businesses/{business_id}/pre-offers",
            headers=headers,
            json={
                "purpose": "inventory",
                "amount_kopecks": 200_000_000,
                "term_months": 12,
                "repayment": repayment,
                "priority": "max_amount",
            },
        )
        assert response.status_code == 201, response.text
