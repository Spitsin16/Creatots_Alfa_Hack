"""Объяснения: клиент видит факторы словами и свои цифры, но не баллы и антифрод."""

import json
from pathlib import Path

import pytest
import yaml

from app.services.explain.guard import numbers_match
from app.services.explain.templates import explain_for_bank, explain_for_client, facts_for_llm
from app.services.scoring.engine import decide

DATA = Path(__file__).resolve().parents[2] / "data"
RULES = yaml.safe_load((DATA / "rules.yaml").read_text(encoding="utf-8"))
PERSONAS = {
    path.stem: json.loads(path.read_text(encoding="utf-8")) for path in sorted((DATA / "personas").glob("p*.json"))
}
DECISIONS = {k: decide(RULES, p) for k, p in PERSONAS.items()}


@pytest.mark.parametrize("pid", sorted(PERSONAS))
def test_client_text_hides_internals(pid: str) -> None:
    text = json.dumps(explain_for_client(DECISIONS[pid], RULES), ensure_ascii=False)
    for forbidden in ("балл", "score", "класс", "MASS_ADDRESS", "CLASS_"):
        assert forbidden not in text.lower() if forbidden.islower() else forbidden not in text, f"{pid}: {forbidden}"


@pytest.mark.parametrize("pid", sorted(PERSONAS))
def test_client_text_has_no_unfilled_placeholders(pid: str) -> None:
    client = explain_for_client(DECISIONS[pid], RULES)
    for value in (client["headline"], client["why_amount"], client["reason"], client["counter"]):
        assert value is None or ("{" not in value and "}" not in value)


def test_p3b_explains_revenue_and_promises_360k() -> None:
    client = explain_for_client(DECISIONS["p3b"], RULES)
    assert client["outcome"] == "APPROVED"
    assert "240 000 ₽" in client["headline"]
    assert "средней выручки" in client["why_amount"] and "270 000 ₽" in client["why_amount"]
    assert "до 360 000 ₽" in client["advice"][0]["text"]
    assert any("другие банки" in w for w in client["weaknesses"])


def test_p1b_counter_offer_shows_saving_not_terms_of_refused_loan() -> None:
    client = explain_for_client(DECISIONS["p1b"], RULES)
    assert "616 327 ₽" in client["counter"]
    assert "terms" not in client


def test_stop_factor_uses_rules_text_with_context() -> None:
    p = PERSONAS["p_stop"]
    client = explain_for_client(DECISIONS["p_stop"], RULES, {"days": p["bki"]["current_overdue_days"]})
    assert client["reason"].startswith(f"Есть текущая просрочка {p['bki']['current_overdue_days']} дней")
    assert client["strengths"] == []


def test_manual_review_reasons_are_human() -> None:
    assert "специалист" in explain_for_client(DECISIONS["p2b"], RULES)["reason"]
    assert "риск-менеджер" in explain_for_client(DECISIONS["p3a"], RULES)["reason"]


def test_bank_view_has_points_and_binding_constraint() -> None:
    bank = explain_for_bank(DECISIONS["p3b"])
    assert bank["score"] == 58 and bank["class"] == "C"
    assert sum(f["points"] for f in bank["factors"]) == 58 - RULES["scoring"]["base"]
    assert [c["code"] for c in bank["limit_candidates"] if c["binding"]] == ["REVENUE"]


def test_llm_guard_rejects_invented_numbers() -> None:
    facts = facts_for_llm(DECISIONS["p3b"], RULES)
    assert numbers_match("Загрузите выписку — лимит вырастет до 360 000 ₽.", facts)[0]
    ok, extra = numbers_match("Лимит вырастет до 400 000 ₽.", facts)
    assert not ok and extra == {"400000"}
