"""Frozen business examples guard every scoring change from formula drift."""

import json
from pathlib import Path

import pytest
import yaml

from app.services.scoring.engine import decide

DATA = Path(__file__).resolve().parents[2] / "data"
EXPECTED = json.loads((DATA / "reference/expected.json").read_text(encoding="utf-8"))
RULES = yaml.safe_load((DATA / "rules.yaml").read_text(encoding="utf-8"))
PERSONA_FILES = sorted((DATA / "personas").glob("p*.json"))


def test_all_personas_have_a_frozen_result() -> None:
    assert {path.stem for path in PERSONA_FILES} == set(EXPECTED)


@pytest.mark.parametrize("persona_file", PERSONA_FILES, ids=lambda path: path.stem)
def test_scoring_matches_frozen_expected_json(persona_file: Path) -> None:
    persona = json.loads(persona_file.read_text(encoding="utf-8"))
    actual = decide(RULES, persona, scenario=persona["persona"]["scenario"])
    expected = EXPECTED[persona_file.stem]

    for key in (
        "cls", "score", "factors", "product", "outcome", "stop_factors",
        "binding_constraint", "reason", "counter", "seasonal_available",
    ):
        assert actual.get(key) == expected.get(key), f"{persona_file.stem}: {key}"
    assert [item["code"] for item in actual.get("advice", [])] == [
        item["code"] for item in expected.get("advice", [])
    ]
    for key in ("limit", "payment"):
        if expected.get(key) is not None:
            assert actual.get(key) == pytest.approx(expected[key], abs=10_000), f"{persona_file.stem}: {key}"
    if expected.get("rate") is not None:
        assert actual.get("rate") == pytest.approx(expected["rate"], abs=0.01)
    else:
        assert actual.get("rate") is None


def test_fragile_class_d_boundary_is_preserved() -> None:
    assert EXPECTED["p2b"]["score"] == EXPECTED["p_stop"]["score"] == 45
    assert EXPECTED["p2b"]["outcome"] == "MANUAL_REVIEW"
    assert EXPECTED["p_stop"]["outcome"] == "REJECTED"
