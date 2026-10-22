"""Чат по заявке со сроком ответа, уведомления в кабинете и SMS-заглушка."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import AuditLog, Message, Notification
from app.services.notifications.sla import MSK, answer_due, due_text
from app.worker import process_one


def login(api: TestClient, username: str) -> dict[str, str]:
    token = api.post("/api/v1/auth/login", json={"login": username, "password": "demo"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def submitted(api: TestClient, username: str = "p3b") -> tuple[dict[str, str], str]:
    headers = login(api, username)
    business_id = api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]
    api.post(f"/api/v1/businesses/{business_id}/consents", headers=headers, json={"kinds": ["BKI", "FNS"]})
    offer = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    ).json()
    app_id = api.post("/api/v1/applications", headers=headers, json={"pre_offer_id": offer["id"]}).json()["id"]
    api.post(f"/api/v1/applications/{app_id}/submit", headers={**headers, "Idempotency-Key": app_id})
    return headers, app_id


def msk(*args: int) -> datetime:
    return datetime(*args, tzinfo=MSK)


def test_sla_four_working_hours() -> None:
    assert answer_due(msk(2026, 10, 22, 10, 0)) == msk(2026, 10, 22, 14, 0).astimezone(UTC)
    # вечер четверга -> пятница 13:00
    assert answer_due(msk(2026, 10, 22, 17, 0)) == msk(2026, 10, 23, 12, 0).astimezone(UTC)
    # пятница 20:00 -> понедельник 13:00
    assert answer_due(msk(2026, 10, 23, 20, 0)) == msk(2026, 10, 26, 13, 0).astimezone(UTC)
    # ночь -> с 9:00
    assert answer_due(msk(2026, 10, 22, 3, 0)) == msk(2026, 10, 22, 13, 0).astimezone(UTC)
    assert due_text(msk(2026, 10, 22, 14, 0), msk(2026, 10, 22, 10, 0)) == "ответим до 14:00"
    assert due_text(msk(2026, 10, 23, 12, 0), msk(2026, 10, 22, 17, 0)) == "ответим завтра до 12:00"


def test_client_question_bank_answer_and_notifications(api: TestClient) -> None:
    client, app_id = submitted(api)
    r = api.post(f"/api/v1/applications/{app_id}/messages", headers=client, json={"text": "Когда будет решение?"})
    assert r.status_code == 201, r.text
    chat = r.json()
    assert chat["open_question_due_at"] is not None
    assert chat["open_question_due_text"].startswith("ответим")

    uw = login(api, "uw1")
    assert api.get(f"/api/v1/applications/{app_id}/messages", headers=uw).json()["items"][0]["text"] == (
        "Когда будет решение?"
    )
    bank_notes = api.get("/api/v1/notifications", headers=uw).json()
    assert any(n["title"] == "Вопрос клиента в чате" for n in bank_notes["items"])

    r = api.post(f"/api/v1/applications/{app_id}/messages", headers=uw, json={"text": "Сегодня до 18:00"})
    assert r.status_code == 201
    assert r.json()["open_question_due_at"] is None
    assert r.json()["items"][1]["author_name"] == "Специалист банка"

    notes = api.get("/api/v1/notifications", headers=client).json()
    titles = [n["title"] for n in notes["items"]]
    assert "Ответ банка в чате" in titles and "Заявка отправлена" in titles
    assert notes["unread_count"] == len(notes["items"])
    assert api.post(f"/api/v1/notifications/{notes['items'][0]['id']}/read", headers=client).status_code == 204
    assert api.get("/api/v1/notifications", headers=client).json()["unread_count"] == notes["unread_count"] - 1
    assert api.post("/api/v1/notifications/read-all", headers=client).status_code == 204
    assert api.get("/api/v1/notifications?unread_only=true", headers=client).json()["items"] == []


def test_approval_sends_in_app_and_sms_stub(api: TestClient) -> None:
    client, app_id = submitted(api)
    with api.app.state.session_factory() as session:
        process_one(session)
    titles = [n["title"] for n in api.get("/api/v1/notifications", headers=client).json()["items"]]
    assert "Кредит одобрен" in titles
    # технические этапы конвейера клиента не беспокоят
    assert not any("VALIDATION" in t or "SCORING" in t for t in titles)
    with api.app.state.session_factory() as session:
        sms = session.scalars(select(AuditLog).where(AuditLog.action == "SMS_STUB")).all()
        assert any("Кредит одобрен" in a.after["text"] for a in sms)
        assert session.scalar(select(Notification).where(Notification.channel == "SMS")) is not None


def test_chat_access_is_limited(api: TestClient) -> None:
    _, app_id = submitted(api)
    other = login(api, "p1a")
    assert api.get(f"/api/v1/applications/{app_id}/messages", headers=other).status_code == 403
    admin = login(api, "admin1")
    assert api.post(f"/api/v1/applications/{app_id}/messages", headers=admin, json={"text": "x"}).status_code == 403
    client = login(api, "p3b")
    assert api.post(f"/api/v1/applications/{app_id}/messages", headers=client, json={"text": ""}).status_code == 422


def test_overdue_question_lifts_application_in_bank_queue(api: TestClient) -> None:
    _, first = submitted(api, "p3b")
    _, second = submitted(api, "p1a")
    client = login(api, "p3b")
    api.post(f"/api/v1/applications/{first}/messages", headers=client, json={"text": "Есть новости?"})
    with api.app.state.session_factory() as session:
        q = session.scalar(select(Message).where(Message.application_id == first))
        q.answer_due_at = datetime.now(UTC) - timedelta(hours=1)
        session.commit()
    queue = api.get("/api/v1/bank/applications", headers=login(api, "uw1")).json()["items"]
    assert queue[0]["id"] == first and queue[0]["question_overdue"] is True
    assert {i["id"] for i in queue} >= {first, second}
