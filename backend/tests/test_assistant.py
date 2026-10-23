"""Ассистент отвечает только по данным клиента и не придумывает цифры."""

import pytest
from fastapi.testclient import TestClient

from app.services.assistant import detect, parse_amount
from tests.test_bank_api import login


@pytest.mark.parametrize(
    "text,intent",
    [
        ("Почему у меня такой лимит?", "WHY_LIMIT"),
        ("Могу ли я взять 500 000 ₽?", "CAN_TAKE"),
        ("Хватит ли денег до конца месяца?", "ENOUGH_MONEY"),
        ("Что с моей заявкой?", "APPLICATION_STATUS"),
        ("Сколько я переплачу?", "OVERPAYMENT"),
        ("Какая погода в Москве?", "OUT_OF_SCOPE"),
    ],
)
def test_intents(text: str, intent: str) -> None:
    assert detect(text) == intent


def test_amounts() -> None:
    assert parse_amount("взять 500 000 ₽") == 500_000
    assert parse_amount("1,5 млн") == 1_500_000
    assert parse_amount("300 тыс") == 300_000
    assert parse_amount("на 12 мес") is None


def ask(api: TestClient, h: dict, text: str) -> dict:
    r = api.post("/api/v1/assistant/messages", headers=h, json={"text": text})
    assert r.status_code == 200, r.text
    return r.json()


def test_p3b_dialogue(api: TestClient) -> None:
    h = login(api, "p3b")
    assert "Сначала рассчитайте" in ask(api, h, "Почему такой лимит?")["answer"]
    assert "12 ноября" in ask(api, h, "Хватит ли до конца месяца?")["answer"]
    assert "Заявок пока нет" in ask(api, h, "Что с моей заявкой?")["answer"]
    bid = api.get("/api/v1/me", headers=h).json()["businesses"][0]["id"]
    api.post(
        f"/api/v1/businesses/{bid}/pre-offers",
        headers=h,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    )
    why = ask(api, h, "Почему у меня такой лимит?")
    assert "270 000 ₽" in why["answer"] and "выписку" in why["answer"]
    assert ask(api, h, "Могу ли я взять 200 000 ₽?")["answer"].startswith("Да")
    more = ask(api, h, "Можно взять 500 тыс?")
    assert "больше лимита" in more["answer"] and more["action"]["target"] == "offer"
    assert "24%" in ask(api, h, "Сколько я переплачу?")["answer"]
    off = ask(api, h, "Расскажи анекдот")
    assert off["intent"] == "OUT_OF_SCOPE" and off["action"] is None


def test_bank_user_has_no_assistant(api: TestClient) -> None:
    r = api.post("/api/v1/assistant/messages", headers=login(api, "uw1"), json={"text": "лимит"})
    assert r.status_code == 403
