"""Клиентские эндпоинты: объяснение, выписка 1С, сезонный график, прогноз разрыва."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import AuditLog, Statement

STATEMENT = (Path(__file__).resolve().parents[2] / "data/statements/p3b_other_bank_1c.txt").read_bytes()


def login(api: TestClient, username: str) -> tuple[dict[str, str], str]:
    token = api.post("/api/v1/auth/login", json={"login": username, "password": "demo"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    business_id = api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]
    return headers, business_id


def p3b_offer(api: TestClient) -> tuple[dict[str, str], str, dict]:
    headers, business_id = login(api, "p3b")
    offer = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    ).json()
    return headers, business_id, offer


def test_explanation_in_words_without_internals(api: TestClient) -> None:
    headers, _, offer = p3b_offer(api)
    response = api.get(f"/api/v1/pre-offers/{offer['id']}/explanation", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert "270 000 ₽" in body["why_amount"]
    assert "до 360 000 ₽" in body["advice"][0]["text"]
    assert body["source"] == "TEMPLATE"
    text = response.text.lower()
    assert "балл" not in text and "score" not in text and "class_" not in text


def test_statement_upload_raises_limit_to_360k(api: TestClient) -> None:
    headers, _, offer = p3b_offer(api)
    response = api.post(
        f"/api/v1/pre-offers/{offer['id']}/statement",
        headers={**headers, "Content-Type": "application/octet-stream"},
        content=STATEMENT,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["previous_limit_kopecks"] == 27_000_000
    assert body["pre_offer"]["limit_kopecks"] == 36_000_000
    assert body["pre_offer"]["outcome"] == "APPROVED"
    assert body["statement"]["full_months"] == 7
    assert "UPLOAD_STATEMENT" not in [a["code"] for a in body["pre_offer"]["advice"]]

    # новое предложение можно оформить как обычное
    created = api.post("/api/v1/applications", headers=headers, json={"pre_offer_id": body["pre_offer"]["id"]})
    assert created.status_code == 201
    with api.app.state.session_factory() as session:
        assert session.scalar(select(Statement).where(Statement.valid.is_(True))) is not None
        assert session.scalar(select(AuditLog).where(AuditLog.action == "STATEMENT_APPLIED")) is not None


def test_bad_statement_is_422_with_client_message(api: TestClient) -> None:
    headers, _, offer = p3b_offer(api)
    response = api.post(
        f"/api/v1/pre-offers/{offer['id']}/statement",
        headers={**headers, "Content-Type": "application/octet-stream"},
        content=b"hello",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "STATEMENT_NOT_1C_FORMAT"


def test_other_client_cannot_read_explanation(api: TestClient) -> None:
    _, _, offer = p3b_offer(api)
    other, _ = login(api, "p1a")
    assert api.get(f"/api/v1/pre-offers/{offer['id']}/explanation", headers=other).status_code == 403


def test_p3a_seasonal_schedule(api: TestClient) -> None:
    headers, business_id = login(api, "p3a")
    offer = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json={
            "purpose": "refinance",
            "amount_kopecks": 550_000_000,
            "term_months": 48,
            "repayment": "seasonal",
            "assets": ["real_estate"],
        },
    ).json()
    response = api.get(f"/api/v1/pre-offers/{offer['id']}/seasonal-schedule", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["schedule"]) == 48
    assert body["schedule"][-1]["balance"] == 0
    assert body["min_payment"] < body["annuity_payment"] < body["max_payment"]


def test_seasonal_not_available_for_overdraft(api: TestClient) -> None:
    headers, _, offer = p3b_offer(api)
    response = api.get(f"/api/v1/pre-offers/{offer['id']}/seasonal-schedule", headers=headers)
    assert response.status_code == 409


def test_forecast_shows_p3b_gap(api: TestClient) -> None:
    headers, business_id = login(api, "p3b")
    response = api.get(
        f"/api/v1/businesses/{business_id}/forecast", headers=headers, params={"overdraft_limit_kopecks": 27_000_000}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["gap"]["date"] == "2026-11-12"
    assert body["gap"]["shortfall"] == 211_060
    assert len(body["series"]) == 30
    assert "закроет разрыв" in body["suggestion"]
