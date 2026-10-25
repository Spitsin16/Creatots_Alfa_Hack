"""Правка ментора 25.10: рейтинг «A 90» словами — только для банка."""

from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from app.services.explain.rating import explain_rating, score_range
from tests.test_bank_api import create_manual_review, login

RULES = yaml.safe_load((Path(__file__).parents[2] / "data/rules.yaml").read_text(encoding="utf-8"))


def test_rating_words() -> None:
    assert score_range(RULES) == (-60, 105)
    a = explain_rating("A", 90, RULES)
    assert a["title"] == "Надёжный заёмщик" and "100% расчётного лимита" in a["conditions"]
    assert "при 79 и ниже — класс B" in a["position"]
    d = explain_rating("D", 45, RULES)  # p2b и p_stop стоят ровно на границе D
    assert "андеррайтер" in d["route"] and "ровно на пороге" in d["position"]
    assert explain_rating("E", 30, RULES)["conditions"] == "кредит не выдаём"


def test_bank_sees_rating_client_does_not(api: TestClient) -> None:
    app_id, client = create_manual_review(
        api, "p2b", {"purpose": "equipment", "amount_kopecks": 100_000_000, "term_months": 24, "urgency": "planned"}
    )
    detail = api.get(f"/api/v1/bank/applications/{app_id}", headers=login(api, "uw1")).json()
    rating = detail["decisions"][0]["rating"]
    assert rating["cls"] == detail["decisions"][0]["cls"] and rating["summary"].startswith(rating["cls"])
    assert "rating" not in api.get(f"/api/v1/applications/{app_id}", headers=client).text
