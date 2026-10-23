"""Нагрузочный прогон без внешних зависимостей (только httpx из backend/requirements.lock).

    python tools/loadtest.py --base http://localhost:8080 --users 20 --seconds 60

Каждый виртуальный пользователь: вход → профиль → предрасчёт → объяснение → прогноз.
Печатает RPS, p50/p95/p99 по каждому запросу и долю ошибок.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import statistics
import time
from collections import defaultdict

import httpx

CLIENTS = {
    "p3b": {"purpose": "cash_gap", "amount_kopecks": 24_000_000, "term_months": 12, "frequency": "always"},
    "p1a": {"purpose": "inventory", "amount_kopecks": 200_000_000, "term_months": 12},
    "p2a": {"purpose": "refinance", "amount_kopecks": 140_000_000, "term_months": 36},
}


async def user(client: httpx.AsyncClient, deadline: float, stats: dict, errors: dict) -> None:
    async def call(name: str, method: str, url: str, **kw):
        t = time.perf_counter()
        try:
            r = await client.request(method, url, **kw)
            ok = r.status_code < 400
        except httpx.HTTPError:
            r, ok = None, False
        stats[name].append(time.perf_counter() - t)
        if not ok:
            errors[name] += 1
        return r if ok else None

    while time.monotonic() < deadline:
        login = random.choice(list(CLIENTS))
        r = await call("login", "POST", "/api/v1/auth/login", json={"login": login, "password": "demo"})
        if r is None:
            continue
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        me = await call("me", "GET", "/api/v1/me", headers=h)
        if me is None:
            continue
        business = me.json()["businesses"][0]["id"]
        offer = await call("pre_offer", "POST", f"/api/v1/businesses/{business}/pre-offers", headers=h, json=CLIENTS[login])
        if offer is not None:
            await call("explanation", "GET", f"/api/v1/pre-offers/{offer.json()['id']}/explanation", headers=h)
        await call("forecast", "GET", f"/api/v1/businesses/{business}/forecast", headers=h)


def pct(values: list[float], q: float) -> float:
    return sorted(values)[min(len(values) - 1, int(len(values) * q))] * 1000


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--users", type=int, default=20)
    ap.add_argument("--seconds", type=int, default=60)
    a = ap.parse_args()
    stats: dict[str, list[float]] = defaultdict(list)
    errors: dict[str, int] = defaultdict(int)
    start = time.monotonic()
    async with httpx.AsyncClient(base_url=a.base, timeout=30) as client:
        await asyncio.gather(*(user(client, start + a.seconds, stats, errors) for _ in range(a.users)))
    elapsed = time.monotonic() - start
    total = sum(len(v) for v in stats.values())
    print(f"{a.users} пользователей, {elapsed:.0f} с, {total} запросов, {total / elapsed:.1f} RPS, "
          f"ошибок {sum(errors.values())} ({sum(errors.values()) / max(total, 1):.2%})")
    print(f"{'запрос':<12}{'n':>7}{'p50 мс':>9}{'p95 мс':>9}{'p99 мс':>9}{'ошибки':>8}")
    for name, v in stats.items():
        print(f"{name:<12}{len(v):>7}{statistics.median(v) * 1000:>9.0f}{pct(v, .95):>9.0f}{pct(v, .99):>9.0f}{errors[name]:>8}")


if __name__ == "__main__":
    asyncio.run(main())
