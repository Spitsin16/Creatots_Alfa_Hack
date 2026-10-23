"""Выписка 1С из другого банка: разбор, проверки и пересчёт предложения p3b."""

import json
from datetime import date
from pathlib import Path

import pytest
import yaml

from app.services.scoring.engine import decide
from app.services.statement_1c.parser import StatementError, extra_revenue_for_scoring, parse

DATA = Path(__file__).resolve().parents[2] / "data"
RAW = (DATA / "statements/p3b_other_bank_1c.txt").read_bytes()
P3B = json.loads((DATA / "personas/p3b.json").read_text(encoding="utf-8"))
RULES = yaml.safe_load((DATA / "rules.yaml").read_text(encoding="utf-8"))
TODAY = date(2026, 10, 22)


def test_parses_cp1251_statement() -> None:
    st = parse(RAW, P3B["registry"]["inn"])
    assert st.owner_inn == P3B["registry"]["inn"]
    assert len(st.documents) == 304
    assert sum(d.is_revenue for d in st.documents) == 259
    assert not st.warnings


def test_own_transfers_and_fees_are_not_revenue() -> None:
    st = parse(RAW)
    for doc in st.documents:
        if "собственных" in doc.purpose or doc.direction == "OUT":
            assert not doc.is_revenue


def test_statement_raises_p3b_offer_to_promised_360k() -> None:
    before = decide(RULES, P3B, with_advice=True)
    promised = next(a for a in before["advice"] if a["code"] == "UPLOAD_STATEMENT")["new_limit"]
    res = extra_revenue_for_scoring(RAW, P3B["registry"]["inn"], TODAY)
    assert res["full_months"] == 7
    after = decide(RULES, P3B, extra_statement_revenue=res["extra_statement_revenue"], with_advice=False)
    assert before["limit"] == 270_000
    assert after["limit"] == promised == 360_000
    assert after["outcome"] == "APPROVED"


def test_utf8_statement_is_accepted() -> None:
    utf8 = RAW.decode("cp1251").replace("Кодировка=Windows", "Кодировка=UTF8").encode("utf-8")
    assert len(parse(utf8).documents) == 304


@pytest.mark.parametrize(
    ("raw", "inn", "code"),
    [
        (b"not a statement", None, "NOT_1C_FORMAT"),
        (RAW, "7700000002", "FOREIGN_INN"),
        (b"x" * (5 * 1024 * 1024 + 1), None, "FILE_TOO_LARGE"),
    ],
)
def test_rejects_bad_files_with_client_message(raw: bytes, inn: str | None, code: str) -> None:
    with pytest.raises(StatementError) as err:
        parse(raw, inn)
    assert err.value.code == code
    assert err.value.message


def test_too_short_statement_is_rejected() -> None:
    with pytest.raises(StatementError) as err:
        extra_revenue_for_scoring(RAW, P3B["registry"]["inn"], date(2026, 4, 10))
    assert err.value.code == "TOO_SHORT"
