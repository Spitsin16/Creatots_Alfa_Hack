"""Переформулировка объяснения через LLM (необязательно).

Любой OpenAI-совместимый API: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL (по умолчанию —
Ollama с Qwen2.5-7B-Instruct). LLM не принимает решений: получает готовые факты и
пишет 2–4 предложения «причина → цифра → что сделать». Ответ отбрасывается, если в нём
есть числа не из фактов или запрещённые слова; таймаут 10 с → шаблон.
"""

from __future__ import annotations

import json
import os

import httpx

from app.services.explain.guard import numbers_match

TIMEOUT = 10.0
FORBIDDEN = ("балл", "скоринг", "класс", "порог", "антифрод", "score", "мошен")

SYSTEM = (
    "Ты пишешь клиенту банка — предпринимателю — короткое объяснение кредитного предложения на русском. "
    "Используй только факты из JSON. Не придумывай чисел, условий и обещаний. Не упоминай баллы, классы, "
    "пороги и внутренние правила. 2–4 предложения: причина → цифра → что сделать, чтобы получить больше. "
    "Числа пиши так же, как в фактах."
)


def configured() -> bool:
    return bool(os.environ.get("LLM_BASE_URL") and os.environ.get("LLM_MODEL"))


def check(text: str, facts: dict) -> tuple[bool, str]:
    if not text or len(text) > 1200:
        return False, "EMPTY_OR_TOO_LONG"
    low = text.lower()
    if any(word in low for word in FORBIDDEN):
        return False, "FORBIDDEN_WORD"
    ok, extra = numbers_match(text, facts)
    if not ok:
        return False, f"UNKNOWN_NUMBERS:{','.join(sorted(extra))}"
    return True, "OK"


def rephrase(facts: dict, transport: httpx.BaseTransport | None = None) -> dict:
    """{"text": str | None, "source": "LLM" | "TEMPLATE", "reason": str}."""
    if not configured() and transport is None:
        return {"text": None, "source": "TEMPLATE", "reason": "LLM_DISABLED"}
    base = os.environ.get("LLM_BASE_URL", "http://llm/v1").rstrip("/")
    headers = {"Authorization": f"Bearer {os.environ.get('LLM_API_KEY', 'none')}"}
    body = {
        "model": os.environ.get("LLM_MODEL", "qwen2.5:7b-instruct-q4_K_M"),
        "temperature": 0.2,
        "max_tokens": 300,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(facts, ensure_ascii=False)},
        ],
    }
    try:
        with httpx.Client(timeout=TIMEOUT, transport=transport) as client:
            r = client.post(f"{base}/chat/completions", json=body, headers=headers)
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"].strip()
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        return {"text": None, "source": "TEMPLATE", "reason": f"LLM_ERROR:{exc.__class__.__name__}"}
    ok, reason = check(text, facts)
    if not ok:
        return {"text": None, "source": "TEMPLATE", "reason": reason}
    return {"text": text, "source": "LLM", "reason": "OK"}
