from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.models import Application, Approval, AuditLog, Decision
from app.worker import process_one


def login(api: TestClient, username: str) -> dict[str, str]:
    response = api.post("/api/v1/auth/login", json={"login": username, "password": "demo"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_manual_review(api: TestClient, username: str, scenario: dict) -> tuple[str, dict[str, str]]:
    headers = login(api, username)
    business_id = api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]
    consent = api.post(
        f"/api/v1/businesses/{business_id}/consents",
        headers=headers,
        json={"kinds": ["BKI", "FNS"]},
    )
    assert consent.status_code == 201
    pre_offer = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json=scenario,
    )
    assert pre_offer.status_code == 201
    application = api.post(
        "/api/v1/applications",
        headers=headers,
        json={"pre_offer_id": pre_offer.json()["id"]},
    )
    assert application.status_code == 201
    application_id = application.json()["id"]
    submitted = api.post(f"/api/v1/applications/{application_id}/submit", headers=headers)
    assert submitted.status_code == 200
    with api.app.state.session_factory() as session:
        assert process_one(session) is True
    detail = api.get(f"/api/v1/applications/{application_id}", headers=headers)
    assert detail.json()["status"] == "MANUAL_REVIEW"
    return application_id, headers


def test_bank_queue_assignment_and_risk_approval_for_large_application(api: TestClient) -> None:
    application_id, client_headers = create_manual_review(
        api,
        "p3a",
        {
            "purpose": "refinance",
            "amount_kopecks": 550_000_000,
            "term_months": 48,
            "frequency": "once",
            "repayment": "seasonal",
            "assets": ["real_estate"],
        },
    )
    denied = api.get("/api/v1/bank/applications", headers=client_headers)
    assert denied.status_code == 403
    assert denied.json()["code"] == "ROLE_DENIED"

    underwriter = login(api, "uw1")
    queue = api.get("/api/v1/bank/applications?status=MANUAL_REVIEW", headers=underwriter)
    assert queue.status_code == 200
    assert queue.json()["total"] == 1
    assert queue.json()["items"][0]["id"] == application_id
    assert queue.json()["items"][0]["decision_class"] is not None

    card = api.get(f"/api/v1/bank/applications/{application_id}", headers=underwriter)
    assert card.status_code == 200
    assert card.json()["decisions"][0]["score"] > 0
    assert "ALFA" in card.json()["snapshots"]

    assigned = api.post(f"/api/v1/bank/applications/{application_id}/assign", headers=underwriter)
    assert assigned.status_code == 200
    second_underwriter = login(api, "uw2")
    conflict = api.post(f"/api/v1/bank/applications/{application_id}/assign", headers=second_underwriter)
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "APPLICATION_ALREADY_ASSIGNED"

    action = api.post(
        f"/api/v1/bank/applications/{application_id}/actions",
        headers=underwriter,
        json={"action": "APPROVE", "comment": "Проверка документов завершена, одобрить"},
    )
    assert action.status_code == 200
    assert action.json()["risk_required"] is True
    assert action.json()["status"] == "MANUAL_REVIEW"

    risk = login(api, "risk1")
    approvals = api.get("/api/v1/bank/approvals", headers=risk)
    assert approvals.status_code == 200
    assert approvals.json()[0]["approval_id"] == action.json()["approval_id"]
    approved = api.post(
        f"/api/v1/bank/approvals/{action.json()['approval_id']}",
        headers=risk,
        json={"action": "APPROVE", "comment": "Лимит риска подтверждён"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "APPROVED"
    repeated = api.post(
        f"/api/v1/bank/approvals/{action.json()['approval_id']}",
        headers=risk,
        json={"action": "APPROVE", "comment": "Повторный запрос"},
    )
    assert repeated.status_code == 200
    assert repeated.json()["result"] == "APPROVED"
    with api.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Approval)) == 2
        assert session.get(Application, application_id).status == "APPROVED"
        assert session.scalar(select(func.count()).select_from(Decision)) == 2
    audit = api.get(
        f"/api/v1/bank/audit?entity_id={application_id}&action=RISK_APPROVE",
        headers=risk,
    )
    assert audit.status_code == 200
    assert audit.json()["total"] == 1
    assert audit.json()["items"][0]["actor_name"] == "Риск-менеджер Волков А."


def test_underwriter_rejection_requires_reason_code_and_is_audited(api: TestClient) -> None:
    application_id, _ = create_manual_review(
        api,
        "p2b",
        {
            "purpose": "equipment",
            "amount_kopecks": 150_000_000,
            "term_months": 24,
            "frequency": "once",
            "urgency": "planned",
        },
    )
    underwriter = login(api, "uw1")
    assert api.post(f"/api/v1/bank/applications/{application_id}/assign", headers=underwriter).status_code == 200

    missing_reason = api.post(
        f"/api/v1/bank/applications/{application_id}/actions",
        headers=underwriter,
        json={"action": "REJECT", "comment": "Недостаточная устойчивость бизнеса"},
    )
    assert missing_reason.status_code == 422
    assert missing_reason.json()["code"] == "REASON_CODE_REQUIRED"

    rejected = api.post(
        f"/api/v1/bank/applications/{application_id}/actions",
        headers=underwriter,
        json={
            "action": "REJECT",
            "comment": "Недостаточная платёжеспособность по документам",
            "reason_code": "LOW_CAPACITY",
        },
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "REJECTED"
    assert rejected.json()["risk_required"] is False
    with api.app.state.session_factory() as session:
        audit = session.scalar(
            select(AuditLog).where(
                AuditLog.entity_id == application_id,
                AuditLog.action == "UNDERWRITER_REJECT",
            )
        )
        assert audit.after["reason_code"] == "LOW_CAPACITY"
