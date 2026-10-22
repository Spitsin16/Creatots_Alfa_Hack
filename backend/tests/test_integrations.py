"""Внешние источники: моки по ИНН, сбои и ретраи клиента."""

import json
import sys
from pathlib import Path

import httpx
import yaml
from fastapi.testclient import TestClient

from app.services.integrations.external import fetch_all, to_engine_input
from app.services.scoring.engine import decide

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from mocks.app import create_app  # noqa: E402

P3B = json.loads((ROOT / "data/personas/p3b.json").read_text(encoding="utf-8"))
P3A = json.loads((ROOT / "data/personas/p3a.json").read_text(encoding="utf-8"))
INN = P3B["registry"]["inn"]


def mocks() -> TestClient:
    return TestClient(create_app(ROOT / "data", timeout_seconds=0))


def transport(client: TestClient) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        r = client.get(request.url.raw_path.decode())
        return httpx.Response(r.status_code, content=r.content, headers=r.headers)

    return httpx.MockTransport(handler)


def test_mocks_serve_persona_blocks_by_inn() -> None:
    c = mocks()
    assert c.get("/health").json()["personas"] == 7
    assert c.get(f"/bki/{INN}").json()["external"] == P3B["bki"]["external"]
    assert c.get(f"/registry/{INN}").json()["okved"] == P3B["registry"]["okved"]
    assert c.get("/fns/0000000000").status_code == 404


def test_mchd_lists_accountant_power_of_attorney() -> None:
    poa = mocks().get(f"/mchd/{P3A['registry']['inn']}").json()["powers_of_attorney"]
    assert poa[0]["permissions"] == ["VIEW", "FILL", "CONSENT"]


def test_one_off_fail_switch() -> None:
    c = mocks()
    assert c.get(f"/fns/{INN}?fail=500").status_code == 500
    assert c.get(f"/fns/{INN}?fail=timeout").status_code == 504
    assert c.get(f"/fns/{INN}").status_code == 200


def test_client_retries_until_source_recovers() -> None:
    c = mocks()
    c.post("/_faults", json={"source": "bki", "mode": "500", "times": 2})
    pauses: list[float] = []
    res = fetch_all(INN, base_url="http://mocks", transport=transport(c), sleep=pauses.append)
    assert res.complete
    assert res.attempts["bki"] == 3
    assert pauses == [0.5, 1.0]


def test_source_down_goes_to_unavailable_not_crash() -> None:
    c = mocks()
    c.post("/_faults", json={"source": "fns", "mode": "timeout", "times": 10})
    res = fetch_all(INN, base_url="http://mocks", transport=transport(c), sleep=lambda s: None)
    assert res.unavailable == ["fns"] and res.attempts["fns"] == 4
    assert "ФНС" in res.unavailable_text()
    assert to_engine_input(res, P3B["persona"]) is None


def test_engine_on_mock_data_matches_direct_persona() -> None:
    rules = yaml.safe_load((ROOT / "data/rules.yaml").read_text(encoding="utf-8"))
    res = fetch_all(INN, base_url="http://mocks", transport=transport(mocks()), sleep=lambda s: None)
    via_mocks = decide(rules, to_engine_input(res, P3B["persona"]))
    direct = decide(rules, P3B)
    assert (via_mocks["limit"], via_mocks["outcome"]) == (direct["limit"], direct["outcome"]) == (270_000, "APPROVED")
