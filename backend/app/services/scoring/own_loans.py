"""Кредит после кредита: выданные в кабинете кредиты как действующие кредиты Альфы.

Снимок `alfa` берётся из моков один раз и не знает о кредитах, выданных здесь.
Без этой функции второй кредит считался бы так, будто первого нет: платёжная
нагрузка занижена, лимит завышен. Чистые функции: на вход фикстура и выданные
кредиты, на выход новая фикстура; исходная не меняется.
"""

from __future__ import annotations

from datetime import date

from app.services.scoring.engine import annuity_payment

SOURCE = "CABINET"
# Новый кредит ещё не показал платёжную дисциплину: в «историю в Альфе» он идёт
# только после стольких месяцев без просрочек (до этого влияет лишь на нагрузку).
HISTORY_AFTER_MONTHS = 6


def monthly_payment(product: str, amount: float, rate: float | None, term_months: int) -> int:
    """Ежемесячная нагрузка по кредиту, ₽.

    Аннуитет — по формуле движка. Овердрафт возобновляемый: берём проценты за месяц
    при полном использовании лимита — консервативная оценка, как в ASSUMPTIONS.md.
    """
    rate = float(rate or 0)
    if product == "OVERDRAFT":
        return round(amount * rate / 100 / 12)
    if rate <= 0:
        return round(amount / max(term_months, 1))
    return round(annuity_payment(amount, rate, term_months))


def as_alfa_credit(loan: dict) -> dict:
    """`loan`: product, amount (₽), rate, term_months, opened (ISO-дата), application_id."""
    opened = date.fromisoformat(str(loan["opened"])[:10])
    return {
        "product": loan["product"],
        "status": "ACTIVE",
        "amount": round(loan["amount"]),
        "opened": opened.isoformat(),
        "balance": round(loan["amount"]),
        "monthly_payment": monthly_payment(loan["product"], loan["amount"], loan.get("rate"), loan["term_months"]),
        "rate": float(loan.get("rate") or 0),
        "payment_day": 1,
        "max_overdue_days": 0,
        "source": SOURCE,
        "application_id": loan.get("application_id"),
    }


def with_own_loans(fixture: dict, loans: list[dict]) -> dict:
    if not loans:
        return fixture
    alfa = dict(fixture["alfa"])
    known = {c.get("application_id") for c in alfa.get("credits", []) if c.get("application_id")}
    alfa["credits"] = [*alfa.get("credits", []), *(as_alfa_credit(x) for x in loans if x.get("application_id") not in known)]
    return {**fixture, "alfa": alfa}


def forecast_payments(loans: list[dict]) -> list[dict]:
    """Платежи по выданным кредитам для прогноза кассового разрыва (кроме овердрафта)."""
    return [
        {"counterparty": "Альфа-Банк, платёж по кредиту", "kind": "LOAN", "day": 1,
         "amount": monthly_payment(x["product"], x["amount"], x.get("rate"), x["term_months"])}
        for x in loans if x["product"] != "OVERDRAFT"
    ]
