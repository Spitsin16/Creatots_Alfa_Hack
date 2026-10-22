"""Прогон версии правил на тестовых персонах до включения (ТЗ 7, кабинет админа).

Чистые функции: правила (dict) + персоны → сравнение исходов «было/стало».
"""

from __future__ import annotations

import yaml

from app.services.scoring.engine import decide

REQUIRED_SECTIONS = ("market", "scoring", "classes", "products", "product_choice", "limit", "rate", "debt_load",
                     "collateral", "outcome", "seasonal_schedule", "stop_factors")


class RulesError(ValueError):
    pass


def parse_rules(text: str) -> dict:
    try:
        rules = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise RulesError(f"YAML не читается: {exc}") from exc
    if not isinstance(rules, dict):
        raise RulesError("Ожидается YAML-словарь с разделами правил")
    missing = [s for s in REQUIRED_SECTIONS if s not in rules]
    if missing:
        raise RulesError(f"Нет разделов: {', '.join(missing)}")
    mins = [c.get("min") for c in rules["classes"]]
    if mins != sorted(mins, reverse=True):
        raise RulesError("Классы должны идти по убыванию минимального балла")
    if rules["market"]["key_rate"] <= 0:
        raise RulesError("Ключевая ставка должна быть положительной")
    return rules


def _short(result: dict) -> dict:
    return {k: result.get(k) for k in ("cls", "score", "product", "outcome", "limit", "rate", "reason")}


def simulate(old_rules: dict, new_rules: dict, personas: list[dict]) -> list[dict]:
    """Для каждой персоны — исход по действующим и по новым правилам."""
    rows = []
    for p in personas:
        before = decide(old_rules, p, with_advice=False)
        try:
            after = _short(decide(new_rules, p, with_advice=False))
        except (KeyError, TypeError, ValueError, ZeroDivisionError, StopIteration) as exc:
            raise RulesError(f"Правила ломают расчёт для {p['persona']['id']}: {exc.__class__.__name__}: {exc}") from exc
        before = _short(before)
        rows.append({
            "persona": p["persona"]["id"],
            "title": p["persona"].get("title", ""),
            "before": before,
            "after": after,
            "changed": before != after,
        })
    return rows
