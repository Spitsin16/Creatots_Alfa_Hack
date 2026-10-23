"""Сезонный график и прогноз кассового разрыва."""

import json
from datetime import date
from pathlib import Path

import pytest
import yaml

from app.services.forecast.cashflow import forecast_for_client
from app.services.scoring.engine import decide, derive
from app.services.seasonal.schedule import annuity_payment, build, is_available

DATA = Path(__file__).resolve().parents[2] / "data"
RULES = yaml.safe_load((DATA / "rules.yaml").read_text(encoding="utf-8"))
EXPECTED = json.loads((DATA / "reference/expected.json").read_text(encoding="utf-8"))


def persona(pid: str) -> dict:
    return json.loads((DATA / f"personas/{pid}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("pid", sorted(EXPECTED))
def test_availability_matches_engine(pid: str) -> None:
    p = persona(pid)
    d = derive(p)
    seasonal_months = is_available(d["months"], d["monthly_revenue"], RULES)
    assert seasonal_months == (d["min_month_share"] < 0.5)


def test_p3a_seasonal_schedule_repays_loan_and_respects_floor() -> None:
    d = derive(persona("p3a"))
    s = build(5_500_000, 17, 48, d["months"], d["monthly_revenue"], date(2026, 11, 1), RULES)
    rows = s["schedule"]
    assert len(rows) == 48 and rows[-1]["balance"] == 0
    assert sum(r["principal"] for r in rows) == pytest.approx(5_500_000, abs=100)
    annuity = annuity_payment(5_500_000, 17, 48)
    assert s["min_payment"] >= round(annuity * 0.3) - 1
    assert s["max_payment"] > annuity > s["min_payment"]
    # в слабые месяцы (январь-февраль) платим меньше аннуитета
    winter = [r["payment"] for r in rows if r["date"][5:7] in ("01", "02")]
    assert max(winter) < annuity
    assert EXPECTED["p3a"]["seasonal_available"] is True


def test_flat_revenue_gives_annuity() -> None:
    months = [f"2025-{m:02d}" for m in range(1, 13)]
    s = build(1_000_000, 20, 12, months, [100.0] * 12, date(2026, 1, 1), RULES)
    assert s["max_payment"] - s["min_payment"] <= 10  # последний платёж добирает копейки округлений
    assert s["annuity_payment"] == pytest.approx(s["max_payment"], abs=2)


def test_p3b_forecast_shows_gap_and_overdraft_closes_it() -> None:
    p = persona("p3b")
    limit = decide(RULES, p, with_advice=False)["limit"]
    f = forecast_for_client(p, overdraft_limit=limit)
    assert f["gap"] == EXPECTED["p3b"]["forecast"]["gap"]
    assert f["headline"] == "12 ноября на счёте может не хватить 211 060 ₽"
    assert "закроет разрыв" in f["suggestion"]


def test_no_gap_message() -> None:
    f = forecast_for_client(persona("p2a"))
    assert f["gap"] is None and "хватает" in f["headline"]
