"""Проверка текста LLM: в ответе не должно быть чисел, которых нет во входных фактах.

Если проверка не прошла — показываем шаблон (AGENTS.md, правило 8).
"""

from __future__ import annotations

import json
import re

_NUMBER = re.compile(r"\d[\d\s ]*(?:[.,]\d+)?")


def _normalize(raw: str) -> str:
    s = raw.replace(" ", "").replace(" ", "").replace(",", ".")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def numbers(text: str) -> set[str]:
    return {_normalize(m.group()) for m in _NUMBER.finditer(text or "") if _normalize(m.group())}


def numbers_match(llm_text: str, facts: dict | list | str) -> tuple[bool, set[str]]:
    """(ок, лишние числа). Числа в фактах берутся из всего JSON фактов."""
    source = facts if isinstance(facts, str) else json.dumps(facts, ensure_ascii=False)
    allowed = numbers(source)
    extra = numbers(llm_text) - allowed
    return not extra, extra
