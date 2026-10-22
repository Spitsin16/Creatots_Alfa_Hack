from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import Base, make_engine
from app.main import app, create_app
from app.models import Application, AuditLog, Business, StatusHistory
from app.seed import seed_all


def test_health() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'api.db'}"
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    engine = make_engine(database_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session, session.begin():
        seed_all(session)
    with TestClient(create_app(database_url)) as client:
        yield client


def login(api: TestClient, username: str = "p3b", password: str = "demo") -> dict[str, str]:
    response = api.post("/api/v1/auth/login", json={"login": username, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_login_and_me_return_business_permissions(api: TestClient) -> None:
    headers = login(api)
    response = api.get("/api/v1/me", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["login"] == "p3b"
    assert body["role"] == "CLIENT"
    assert len(body["businesses"]) == 1
    assert body["businesses"][0]["membership_kind"] == "OWNER"
    assert body["businesses"][0]["permissions"] == ["VIEW", "FILL", "CONSENT", "SUBMIT", "SIGN"]


def test_authentication_errors_use_public_envelope(api: TestClient) -> None:
    response = api.post("/api/v1/auth/login", json={"login": "p3b", "password": "wrong"})
    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_CREDENTIALS"
    assert response.json()["request_id"] == response.headers["X-Request-ID"]

    response = api.get("/api/v1/me", headers={"Authorization": "Bearer broken.token.value"})
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


def test_p3b_pre_offer_matches_frozen_reference_without_internal_score(api: TestClient) -> None:
    headers = login(api)
    me = api.get("/api/v1/me", headers=headers).json()
    business_id = me["businesses"][0]["id"]

    response = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json={
            "purpose": "cash_gap",
            "amount_kopecks": 24_000_000,
            "term_months": 12,
            "frequency": "always",
            "urgency": "days",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["outcome"] == "APPROVED"
    assert body["product"] == "OVERDRAFT"
    assert body["limit_kopecks"] == 27_000_000
    assert body["rate"] == 24.0
    assert [item["code"] for item in body["advice"]] == ["UPLOAD_STATEMENT", "MOVE_TURNOVER"]
    assert "score" not in body
    assert "factors" not in body


def test_create_application_writes_draft_history_and_audit_in_one_flow(api: TestClient) -> None:
    headers = login(api)
    business_id = api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]
    pre_offer = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json={
            "purpose": "cash_gap",
            "amount_kopecks": 24_000_000,
            "term_months": 12,
            "frequency": "always",
        },
    ).json()

    response = api.post("/api/v1/applications", headers=headers, json={"pre_offer_id": pre_offer["id"]})

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "DRAFT"
    assert body["amount_kopecks"] == 24_000_000
    with api.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Application)) == 1
        history = session.scalar(select(StatusHistory).where(StatusHistory.application_id == body["id"]))
        assert history.from_status is None
        assert history.to_status == "DRAFT"
        audit = session.scalar(
            select(AuditLog).where(
                AuditLog.entity_id == body["id"],
                AuditLog.action == "APPLICATION_CREATED",
            )
        )
        assert audit.after == {"status": "DRAFT", "version": 1}


def test_user_cannot_create_pre_offer_for_another_business(api: TestClient) -> None:
    headers = login(api)
    with api.app.state.session_factory() as session:
        other_business = session.scalar(select(Business).where(Business.inn != "770000003103"))

    response = api.post(
        f"/api/v1/businesses/{other_business.id}/pre-offers",
        headers=headers,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "BUSINESS_ACCESS_DENIED"


def test_mchd_employee_can_prepare_draft_with_fill_permission(api: TestClient) -> None:
    headers = login(api, "p3a_acc")
    business = api.get("/api/v1/me", headers=headers).json()["businesses"][0]
    assert business["permissions"] == ["VIEW", "FILL", "CONSENT"]

    pre_offer = api.post(
        f"/api/v1/businesses/{business['id']}/pre-offers",
        headers=headers,
        json={
            "purpose": "refinance",
            "amount_kopecks": 550_000_000,
            "term_months": 48,
            "frequency": "once",
            "repayment": "seasonal",
            "assets": ["real_estate"],
        },
    )
    assert pre_offer.status_code == 201
    draft = api.post(
        "/api/v1/applications",
        headers=headers,
        json={"pre_offer_id": pre_offer.json()["id"]},
    )
    assert draft.status_code == 201
    assert draft.json()["status"] == "DRAFT"
