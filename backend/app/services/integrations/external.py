"""Клиент внешних источников (сервис mocks) с ретраями.

Повторяем сбой 3 раза с растущей паузой (0,5 → 1 → 2 с). 404 — это ответ источника
(«не найден»), его не повторяем. Если источник так и не ответил, конвейер не падает:
источник попадает в `unavailable`, а заявка уходит в ручную проверку с пометкой
«источник недоступен» (ТЗ раздел 12).
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx

SOURCES = ("alfa", "registry", "fns", "bki")
DEFAULT_BASE_URL = os.environ.get("MOCKS_URL", "http://mocks:8100")
RETRIES = 3
BASE_DELAY = 0.5
TIMEOUT = 5.0

SOURCE_TITLES = {
    "alfa": "данные Альфа-Банка",
    "registry": "ЕГРЮЛ/ЕГРИП",
    "fns": "ФНС",
    "bki": "бюро кредитных историй",
    "mchd": "реестр МЧД",
}


@dataclass
class SourceResult:
    source: str
    ok: bool
    data: dict | None = None
    attempts: int = 0
    error: str | None = None
    not_found: bool = False


@dataclass
class FetchResult:
    data: dict = field(default_factory=dict)
    unavailable: list[str] = field(default_factory=list)
    not_found: list[str] = field(default_factory=list)
    attempts: dict = field(default_factory=dict)

    @property
    def complete(self) -> bool:
        return not self.unavailable and not self.not_found

    def unavailable_text(self) -> str | None:
        if not self.unavailable:
            return None
        names = ", ".join(SOURCE_TITLES.get(s, s) for s in self.unavailable)
        return f"Источник недоступен: {names}. Заявка передана специалисту, данные запросим повторно."


def fetch_source(
    client: httpx.Client,
    source: str,
    inn: str,
    retries: int = RETRIES,
    base_delay: float = BASE_DELAY,
    sleep: Callable[[float], None] = time.sleep,
) -> SourceResult:
    error = None
    for attempt in range(1, retries + 2):
        try:
            response = client.get(f"/{source}/{inn}")
        except httpx.TimeoutException:
            error = "TIMEOUT"
        except httpx.TransportError as exc:
            error = f"TRANSPORT: {exc.__class__.__name__}"
        else:
            if response.status_code == 200:
                return SourceResult(source, True, response.json(), attempt)
            if response.status_code == 404:
                return SourceResult(source, False, None, attempt, "NOT_FOUND", not_found=True)
            error = f"HTTP_{response.status_code}"
        if attempt <= retries:
            sleep(base_delay * 2 ** (attempt - 1))
    return SourceResult(source, False, None, retries + 1, error)


def fetch_all(
    inn: str,
    base_url: str = DEFAULT_BASE_URL,
    sources: tuple[str, ...] = SOURCES,
    transport: httpx.BaseTransport | None = None,
    sleep: Callable[[float], None] = time.sleep,
    timeout: float = TIMEOUT,
) -> FetchResult:
    result = FetchResult()
    with httpx.Client(base_url=base_url, timeout=timeout, transport=transport) as client:
        for source in sources:
            r = fetch_source(client, source, inn, sleep=sleep)
            result.attempts[source] = r.attempts
            if r.ok:
                result.data[source] = r.data
            elif r.not_found:
                result.not_found.append(source)
            else:
                result.unavailable.append(source)
    return result


def to_engine_input(fetched: FetchResult, persona_meta: dict) -> dict | None:
    """Собирает вход `scoring.engine.decide` из ответов источников (None — данных не хватает)."""
    if not fetched.complete:
        return None
    strip = {k: {kk: vv for kk, vv in v.items() if kk != "inn"} for k, v in fetched.data.items()}
    return {"persona": persona_meta, **strip}
