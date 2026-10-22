"""Воркер ходит во внешние источники; недоступный источник → ручная проверка, не падение."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import worker
from app.models import AuditLog, Decision
from app.services.integrations.external import FetchResult


def submitted_p3b(api: TestClient) -> tuple[dict[str, str], str]:
    token = api.post("/api/v1/auth/login", json={"login": "p3b", "password": "demo"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    business_id = api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]
    api.post(f"/api/v1/businesses/{business_id}/consents", headers=headers, json={"kinds": ["BKI", "FNS"]})
    offer = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    ).json()
    app_id = api.post("/api/v1/applications", headers=headers, json={"pre_offer_id": offer["id"]}).json()["id"]
    assert (
        api.post(f"/api/v1/applications/{app_id}/submit", headers={**headers, "Idempotency-Key": app_id}).status_code
        == 200
    )
    return headers, app_id


def test_unavailable_source_sends_application_to_manual_review(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MOCKS_URL", "http://mocks:8100")
    monkeypatch.setattr(
        worker,
        "fetch_all",
        lambda inn, base_url: FetchResult(
            data={}, unavailable=["bki"], attempts={"alfa": 1, "registry": 1, "fns": 1, "bki": 4}
        ),
    )
    headers, app_id = submitted_p3b(api)
    with api.app.state.session_factory() as session:
        assert worker.process_one(session) is True

    body = api.get(f"/api/v1/applications/{app_id}", headers=headers).json()
    assert body["status"] == "MANUAL_REVIEW"
    assert "бюро кредитных историй" in body["decision"]["explanation"]
    with api.app.state.session_factory() as session:
        audit = session.scalar(select(AuditLog).where(AuditLog.action == "SOURCES_REQUESTED"))
        assert audit.after["unavailable"] == ["bki"] and audit.after["attempts"]["bki"] == 4
        assert session.scalar(select(Decision)).outcome == "MANUAL_REVIEW"


def test_all_sources_ok_keeps_automatic_decision(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOCKS_URL", "http://mocks:8100")
    monkeypatch.setattr(
        worker,
        "fetch_all",
        lambda inn, base_url: FetchResult(
            data={"alfa": {}, "registry": {}, "fns": {}, "bki": {}},
            attempts={"alfa": 1, "registry": 1, "fns": 1, "bki": 1},
        ),
    )
    headers, app_id = submitted_p3b(api)
    with api.app.state.session_factory() as session:
        worker.process_one(session)
    assert api.get(f"/api/v1/applications/{app_id}", headers=headers).json()["status"] == "APPROVED"
