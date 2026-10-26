"""Сброс демо-стенда: заявки, чаты, журнал и клиенты песочницы исчезают, демо-учётки остаются."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.models import Application, AuditLog, Business, Notification, PreOffer, Rule, User
from tests.test_bank_api import create_manual_review, login


def count(api: TestClient, model) -> int:
    login(api, "p3b")  # фабрика сессий создаётся при первом запросе
    with api.app.state.session_factory() as session:
        return session.scalar(select(func.count()).select_from(model)) or 0


def test_reset_returns_stand_to_first_launch(api: TestClient) -> None:
    users_before, businesses_before = count(api, User), count(api, Business)
    app_id, client = create_manual_review(
        api, "p3a",
        {"purpose": "refinance", "amount_kopecks": 550_000_000, "term_months": 48, "repayment": "seasonal", "assets": ["real_estate"]},
    )
    api.post(f"/api/v1/applications/{app_id}/messages", headers=client, json={"text": "Добрый день"})
    sandbox = api.post("/api/v1/sandbox/clients", json={})
    assert sandbox.status_code == 201
    assert count(api, Application) == 1 and count(api, Notification) > 0 and count(api, User) == users_before + 1

    r = api.post("/api/v1/demo/reset")
    assert r.status_code == 200 and r.json()["reset"] is True
    assert r.json()["removed"]["sandbox_clients"] == 1

    for model in (Application, PreOffer, Notification, AuditLog):
        assert count(api, model) == 0, model.__tablename__
    assert count(api, User) == users_before and count(api, Business) == businesses_before
    with api.app.state.session_factory() as session:
        rules = session.scalars(select(Rule)).all()
    assert len(rules) == 1 and rules[0].active

    # Демо-учётки входят, у клиента пусто, очередь банка пуста, песочный клиент больше не входит
    mine = api.get("/api/v1/applications", headers=client).json()
    assert len(mine if isinstance(mine, list) else mine["items"]) == 0
    queue = api.get("/api/v1/bank/applications", headers=login(api, "uw1")).json()
    assert queue["total"] == 0
    assert api.post("/api/v1/auth/login", json={"login": sandbox.json()["login"], "password": "demo"}).status_code == 401

    # После сброса сценарий проходит заново
    again, _ = create_manual_review(
        api, "p3a",
        {"purpose": "refinance", "amount_kopecks": 550_000_000, "term_months": 48, "repayment": "seasonal", "assets": ["real_estate"]},
    )
    assert again != app_id


def test_reset_twice_is_harmless(api: TestClient) -> None:
    assert api.post("/api/v1/demo/reset").status_code == 200
    assert api.post("/api/v1/demo/reset").status_code == 200
    assert api.post("/api/v1/auth/login", json={"login": "p3b", "password": "demo"}).status_code == 200
