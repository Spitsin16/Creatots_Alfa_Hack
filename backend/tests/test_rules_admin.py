"""Админ правил: прогон на персонах, новая версия, включение, откат."""

from pathlib import Path

from fastapi.testclient import TestClient

RULES = (Path(__file__).resolve().parents[2] / "data/rules.yaml").read_text(encoding="utf-8")


def login(api: TestClient, username: str) -> dict[str, str]:
    token = api.post("/api/v1/auth/login", json={"login": username, "password": "demo"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_same_rules_change_nothing(api: TestClient) -> None:
    r = api.post("/api/v1/bank/rules/simulate", headers=login(api, "admin1"), json={"yaml": RULES})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["personas"]) == 7 and body["changed"] == 0


def test_raising_key_rate_shows_impact_then_activate_and_rollback(api: TestClient) -> None:
    admin = login(api, "admin1")
    stricter = RULES.replace("key_rate: 14.0", "key_rate: 21.0")
    assert stricter != RULES
    sim = api.post("/api/v1/bank/rules/simulate", headers=admin, json={"yaml": stricter}).json()
    p1a = next(r for r in sim["personas"] if r["persona"] == "p1a")
    assert p1a["changed"] and p1a["before"]["rate"] == 18.0 and p1a["after"]["rate"] == 22.0

    created = api.post(
        "/api/v1/bank/rules", headers=admin, json={"yaml": stricter, "comment": "ставка ЦБ", "activate": True}
    )
    assert created.status_code == 201 and created.json()["version"] == 2
    listing = api.get("/api/v1/bank/rules", headers=admin).json()
    assert listing["active_version"] == 2

    # новое предложение считается по версии 2
    client = login(api, "p1a")
    business_id = api.get("/api/v1/me", headers=client).json()["businesses"][0]["id"]
    offer = api.post(
        f"/api/v1/businesses/{business_id}/pre-offers",
        headers=client,
        json={"purpose": "inventory", "amount_kopecks": 200_000_000, "term_months": 12},
    ).json()
    assert offer["rate"] >= 22.0

    assert api.post("/api/v1/bank/rules/1/activate", headers=admin).status_code == 200
    assert api.get("/api/v1/bank/rules", headers=admin).json()["active_version"] == 1


def test_broken_rules_rejected(api: TestClient) -> None:
    admin = login(api, "admin1")
    r = api.post("/api/v1/bank/rules/simulate", headers=admin, json={"yaml": "market: [oops"})
    assert r.status_code == 422 and r.json()["code"] == "RULES_INVALID"
    r = api.post("/api/v1/bank/rules", headers=admin, json={"yaml": "version: 2\nmarket: {key_rate: 14}\n"})
    assert r.status_code == 422


def test_only_rules_admin_can_change(api: TestClient) -> None:
    uw = login(api, "uw1")
    assert api.get("/api/v1/bank/rules", headers=uw).status_code == 200
    assert api.post("/api/v1/bank/rules", headers=uw, json={"yaml": RULES}).status_code == 403
    assert api.get("/api/v1/bank/rules", headers=login(api, "p3b")).status_code == 403
