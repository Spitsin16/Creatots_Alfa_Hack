"""Моки внешних систем: Альфа, ЕГРЮЛ/ЕГРИП, ФНС, БКИ, МЧД.

Отдаёт блоки синтетических персон из data/personas по ИНН — так же, как ответили бы
боевые сервисы. Бэк ходит сюда по HTTP; замена мока на интеграцию не меняет конвейер.

Сбои для демо отказоустойчивости:
  * разово — `?fail=timeout|500` к любому запросу;
  * по расписанию — `POST /_faults {"source": "bki", "mode": "500", "times": 2}`:
    следующие 2 запроса к /bki упадут, затем сервис «восстановится».
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

DATA = Path(os.environ.get("MOCKS_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
TIMEOUT_SECONDS = float(os.environ.get("MOCKS_TIMEOUT_SECONDS", "15"))
# Клиенты из песочницы проверяющего живут в БД API, а не в файлах — спрашиваем у API.
SANDBOX_URL = os.environ.get("SANDBOX_URL", "")
SOURCES = ("alfa", "registry", "fns", "bki", "mchd")


def load_personas(data_dir: Path = DATA) -> dict[str, dict]:
    """ИНН -> персона."""
    out = {}
    for path in sorted((data_dir / "personas").glob("p*.json")):
        persona = json.loads(path.read_text(encoding="utf-8"))
        out[persona["registry"]["inn"]] = persona
    return out


def source_payload(persona: dict, source: str) -> dict:
    inn = persona["registry"]["inn"]
    if source == "mchd":
        return {
            "inn": inn,
            "powers_of_attorney": [
                {
                    "number": e["mchd"]["number"],
                    "representative": e["full_name"],
                    "role": e["role"],
                    "valid_to": e["mchd"]["valid_to"],
                    "permissions": e["mchd"]["permissions"],
                }
                for e in persona["persona"].get("employees", [])
                if e.get("mchd")
            ],
        }
    return {"inn": inn, **persona[source]}


class Fault(BaseModel):
    source: str = Field(pattern="^(alfa|registry|fns|bki|mchd)$")
    mode: str = Field(pattern="^(timeout|500)$")
    times: int = Field(default=1, ge=1, le=100)


async def fetch_sandbox(base_url: str, inn: str, source: str) -> dict | None:
    import httpx

    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=5) as client:
            r = await client.get(f"/api/v1/sandbox/sources/{inn}/{source}")
    except httpx.HTTPError:
        return None
    return r.json() if r.status_code == 200 else None


def create_app(data_dir: Path = DATA, timeout_seconds: float = TIMEOUT_SECONDS, sandbox_url: str = SANDBOX_URL,
               sandbox_fetch=fetch_sandbox) -> FastAPI:
    app = FastAPI(title="Моки внешних систем (синтетика)", version="1.0.0")
    personas = load_personas(data_dir)
    faults: dict[str, dict] = {}
    calls: dict[str, int] = {s: 0 for s in SOURCES}

    async def fail(mode: str):
        if mode == "timeout":
            await asyncio.sleep(timeout_seconds)
            return JSONResponse({"error": "TIMEOUT", "message": "Источник не ответил вовремя"}, status_code=504)
        return JSONResponse({"error": "INTERNAL", "message": "Внутренняя ошибка источника"}, status_code=500)

    async def respond(source: str, inn: str, fail_mode: str | None):
        calls[source] += 1
        if fail_mode:
            return await fail(fail_mode)
        planned = faults.get(source)
        if planned and planned["times"] > 0:
            planned["times"] -= 1
            if planned["times"] == 0:
                faults.pop(source)
            return await fail(planned["mode"])
        persona = personas.get(inn)
        if persona is None:
            data = await sandbox_fetch(sandbox_url, inn, source) if sandbox_url else None
            if data is not None:
                return data
            raise HTTPException(404, detail={"error": "NOT_FOUND", "message": f"ИНН {inn} не найден"})
        return source_payload(persona, source)

    @app.get("/health")
    def health() -> dict:
        return {"status": "alive", "personas": len(personas)}

    for source in SOURCES:

        def make(src: str):
            async def handler(inn: str, fail: str | None = Query(default=None, pattern="^(timeout|500)$")):
                return await respond(src, inn, fail)

            handler.__name__ = f"get_{src}"
            return handler

        app.get(f"/{source}/{{inn}}", summary=f"Данные источника {source} по ИНН")(make(source))

    @app.post("/_faults", status_code=201, summary="Запланировать сбои источника")
    def add_fault(fault: Fault) -> dict:
        faults[fault.source] = {"mode": fault.mode, "times": fault.times}
        return {"faults": faults}

    @app.get("/_faults", summary="Запланированные сбои и счётчики вызовов")
    def list_faults() -> dict:
        return {"faults": faults, "calls": calls}

    @app.delete("/_faults", summary="Снять все сбои")
    def clear_faults() -> dict:
        faults.clear()
        return {"faults": faults}

    return app


app = create_app()
