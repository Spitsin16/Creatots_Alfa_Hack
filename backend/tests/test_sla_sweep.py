"""Заявка, которую исполнитель не рассмотрел за рабочий день, возвращается в общую очередь."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Application, AuditLog, Notification
from app.services.sla_sweep import release_overdue
from tests.test_bank_api import create_manual_review, login


def assigned_application(api: TestClient) -> str:
    application_id, _ = create_manual_review(
        api, "p2b", {"purpose": "equipment", "amount_kopecks": 150_000_000, "term_months": 24, "urgency": "planned"}
    )
    assert api.post(f"/api/v1/bank/applications/{application_id}/assign", headers=login(api, "uw1")).status_code == 200
    return application_id


def test_within_sla_assignment_is_kept(api: TestClient) -> None:
    assigned_application(api)
    with api.app.state.session_factory() as session:
        assert release_overdue(session) == []


def test_overdue_assignment_returns_to_queue(api: TestClient) -> None:
    application_id = assigned_application(api)
    with api.app.state.session_factory() as session:
        audit = session.scalar(select(AuditLog).where(AuditLog.action == "APPLICATION_ASSIGNED"))
        audit.at = datetime.now(UTC) - timedelta(days=5)
        session.commit()
        assert release_overdue(session) == [application_id]
        session.commit()
        assert session.get(Application, application_id).assignee_id is None
        assert session.scalar(select(AuditLog).where(AuditLog.action == "APPLICATION_UNASSIGNED_SLA")) is not None
        assert session.scalar(select(Notification).where(Notification.title == "Заявка возвращена в очередь"))
        assert release_overdue(session) == []
    # другой андеррайтер может взять
    assert api.post(f"/api/v1/bank/applications/{application_id}/assign", headers=login(api, "uw2")).status_code == 200
