"""Прогноз кассового разрыва на 30 дней (модуль кабинета, за флагом).

Расчёт — `scoring.engine.cashflow_forecast` (сверяется с эталоном), здесь — то,
что видит клиент: дата, сколько не хватит, из-за каких платежей и что предложить.
"""

from __future__ import annotations

from datetime import date

from app.services.scoring.engine import cashflow_forecast

MONTHS_GEN = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
]


def rub(value: float) -> str:
    return f"{round(value):,} ₽".replace(",", " ")


def human_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {MONTHS_GEN[d.month - 1]}"


def forecast_for_client(persona: dict, days: int = 30, overdraft_limit: float | None = None) -> dict:
    """`overdraft_limit` — доступный овердрафт из предложения, если он есть."""
    f = cashflow_forecast(persona, days)
    gap = f["gap"]
    res = {
        "start_balance": round(f["start_balance"]),
        "series": f["series"],
        "recurring": f["recurring"],
        "gap": gap,
        "headline": None,
        "details": [],
        "suggestion": None,
    }
    if gap is None:
        res["headline"] = f"В ближайшие {days} дней денег на счёте хватает на все регулярные платежи"
        return res
    res["headline"] = f"{human_date(gap['date'])} на счёте может не хватить {rub(gap['shortfall'])}"
    res["details"] = [f"В этот день списываются: {', '.join(gap['reasons'])}"] if gap["reasons"] else []
    need = gap["overdraft_suggestion"]
    if overdraft_limit and overdraft_limit >= gap["shortfall"]:
        res["suggestion"] = (
            f"Овердрафт до {rub(overdraft_limit)} закроет разрыв: деньги спишутся автоматически "
            "и вернутся с первыми поступлениями"
        )
    elif overdraft_limit:
        res["suggestion"] = (
            f"Доступного овердрафта {rub(overdraft_limit)} не хватит на весь разрыв — "
            f"нужно около {rub(need)}. Посмотрите, как увеличить сумму"
        )
    else:
        res["suggestion"] = f"Чтобы закрыть разрыв, подойдёт овердрафт на {rub(need)}"
    return res
