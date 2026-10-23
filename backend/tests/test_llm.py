"""LLM только переформулирует: чужие числа, запрещённые слова и сбои → шаблон."""

import json
from pathlib import Path

import httpx
import pytest
import yaml
from fastapi.testclient import TestClient

from app import worker
from app.services.explain import llm
from app.services.explain.templates import facts_for_llm
from app.services.scoring.engine import decide

DATA = Path(__file__).resolve().parents[2] / "data"
RULES = yaml.safe_load((DATA / "rules.yaml").read_text(encoding="utf-8"))
FACTS = facts_for_llm(decide(RULES, json.loads((DATA / "personas/p3b.json").read_text(encoding="utf-8"))), RULES)


def answer(text: str | None = None, status: int = 200, exc: Exception | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if exc:
            raise exc
        body = json.loads(request.content)
        assert body["messages"][0]["role"] == "system"
        return httpx.Response(status, json={"choices": [{"message": {"content": text}}]})

    return httpx.MockTransport(handler)


def test_good_answer_is_used() -> None:
    text = "Сумму считаем от средней выручки 917 271 ₽ в месяц — это до 270 000 ₽. Загрузите выписку — до 360 000 ₽."
    res = llm.rephrase(FACTS, transport=answer(text))
    assert res == {"text": text, "source": "LLM", "reason": "OK"}


@pytest.mark.parametrize(
    "text,reason",
    [
        ("Мы одобрим до 500 000 ₽.", "UNKNOWN_NUMBERS:500000"),
        ("Ваш балл 58, поэтому лимит 270 000 ₽.", "FORBIDDEN_WORD"),
        ("", "EMPTY_OR_TOO_LONG"),
    ],
)
def test_bad_answers_fall_back_to_template(text: str, reason: str) -> None:
    res = llm.rephrase(FACTS, transport=answer(text))
    assert res["source"] == "TEMPLATE" and res["reason"] == reason and res["text"] is None


def test_timeout_and_errors_fall_back() -> None:
    assert llm.rephrase(FACTS, transport=answer(exc=httpx.ReadTimeout("slow")))["reason"] == "LLM_ERROR:ReadTimeout"
    assert llm.rephrase(FACTS, transport=answer("x", status=500))["source"] == "TEMPLATE"


def test_disabled_without_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    assert llm.rephrase(FACTS)["reason"] == "LLM_DISABLED"


def test_worker_attaches_llm_text_to_offer(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "http://llm/v1")
    monkeypatch.setenv("LLM_MODEL", "test")
    monkeypatch.setattr(
        worker, "rephrase", lambda facts: {"text": "Коротко: до 270 000 ₽.", "source": "LLM", "reason": "OK"}
    )
    token = api.post("/api/v1/auth/login", json={"login": "p3b", "password": "demo"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    business_id = api.get("/api/v1/me", headers=headers).json()["businesses"][0]["id"]
    offer = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=headers,
        json={"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    ).json()
    before = api.get(f"/api/v1/pre-offers/{offer['id']}/explanation", headers=headers).json()
    assert before["source"] == "TEMPLATE" and before["summary"] is None
    with api.app.state.session_factory() as session:
        assert worker.process_one(session) is True
    after = api.get(f"/api/v1/pre-offers/{offer['id']}/explanation", headers=headers).json()
    assert after["source"] == "LLM" and after["summary"] == "Коротко: до 270 000 ₽."
    assert after["why_amount"] == before["why_amount"]
