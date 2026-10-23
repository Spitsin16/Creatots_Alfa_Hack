from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import Application, AuditLog, Business, Contract, Decision, Outbox, StatusHistory
from app.worker import process_one


def test_health() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def login(api: TestClient, username: str = "p3b", password: str = "demo") -> dict[str, str]:
    response = api.post("/api/v1/auth/login", json={"login": username, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def give_consents(api: TestClient, headers: dict[str, str], business_id: str) -> None:
    response = api.post(
        f"/api/v1/businesses/{business_id}/consents",
        headers=headers,
        json={"kinds": ["BKI", "FNS"]},
    )
    assert response.status_code == 201


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


def test_submit_is_idempotent_and_worker_creates_client_safe_decision(api: TestClient) -> None:
    headers = login(api)
    business_id = api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]
    give_consents(api, headers, business_id)
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
    application = api.post(
        "/api/v1/applications",
        headers=headers,
        json={"pre_offer_id": pre_offer["id"]},
    ).json()
    submit_headers = {**headers, "Idempotency-Key": "p3b-submit-1"}

    first = api.post(f"/api/v1/applications/{application['id']}/submit", headers=submit_headers)
    second = api.post(f"/api/v1/applications/{application['id']}/submit", headers=submit_headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["status"] == second.json()["status"] == "SUBMITTED"
    with api.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Outbox)) == 1
        assert process_one(session) is True

    detail = api.get(f"/api/v1/applications/{application['id']}", headers=headers)
    assert detail.status_code == 200
    body = detail.json()
    assert body["status"] == "APPROVED"
    assert [item["to_status"] for item in body["timeline"]] == [
        "DRAFT",
        "SUBMITTED",
        "VALIDATION",
        "ENRICHMENT",
        "SCORING",
        "APPROVED",
    ]
    assert body["decision"]["outcome"] == "APPROVED"
    assert body["decision"]["limit_kopecks"] == 27_000_000
    assert body["decision"]["rate"] == 24.0
    assert "score" not in body["decision"]
    assert "factors" not in body["decision"]
    with api.app.state.session_factory() as session:
        decision = session.scalar(select(Decision).where(Decision.application_id == application["id"]))
        assert decision.score == 58
        assert decision.cls == "C"
        event = session.scalar(select(Outbox))
        assert event.status == "DONE"

    bad_code = api.post(
        f"/api/v1/applications/{application['id']}/sign",
        headers=headers,
        json={"code": "1234"},
    )
    assert bad_code.status_code == 422
    assert bad_code.json()["code"] == "INVALID_SIGN_CODE"

    sign_headers = {**headers, "Idempotency-Key": "p3b-sign-1"}
    signed = api.post(
        f"/api/v1/applications/{application['id']}/sign",
        headers=sign_headers,
        json={"code": "0000"},
    )
    signed_again = api.post(
        f"/api/v1/applications/{application['id']}/sign",
        headers=sign_headers,
        json={"code": "0000"},
    )
    assert signed.status_code == 200
    assert signed_again.status_code == 200
    assert signed.json()["status"] == signed_again.json()["status"] == "CONTRACT_SIGNED"
    with api.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Contract)) == 1
        assert session.scalar(select(func.count()).select_from(Outbox)) == 2
        assert process_one(session) is True

    issued = api.get(f"/api/v1/applications/{application['id']}", headers=headers).json()
    assert issued["status"] == "ISSUED"
    assert [item["to_status"] for item in issued["timeline"]][-2:] == ["CONTRACT_SIGNED", "ISSUED"]


def test_submit_requires_bki_and_fns_consents(api: TestClient) -> None:
    headers = login(api)
    business_id = api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]
    pre_offer = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    ).json()
    application = api.post(
        "/api/v1/applications", headers=headers, json={"pre_offer_id": pre_offer["id"]}
    ).json()

    response = api.post(f"/api/v1/applications/{application['id']}/submit", headers=headers)

    assert response.status_code == 409
    assert response.json()["code"] == "CONSENTS_REQUIRED"
    assert response.json()["details"] == {"missing": ["BKI", "FNS"]}


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
    give_consents(api, headers, business["id"])

    waiting = api.post(
        f"/api/v1/applications/{draft.json()['id']}/submit",
        headers={**headers, "Idempotency-Key": "employee-submit-1"},
    )
    assert waiting.status_code == 200
    assert waiting.json()["status"] == "AWAITING_SIGNATURE"

    director_headers = login(api, "p3a")
    submitted = api.post(
        f"/api/v1/applications/{draft.json()['id']}/submit",
        headers={**director_headers, "Idempotency-Key": "director-submit-1"},
    )
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "SUBMITTED"
    with api.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Outbox)) == 1
