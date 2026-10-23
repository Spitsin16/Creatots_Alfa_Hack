"""Сезонный график платежей (ТЗ 6.3): платёж пропорционален выручке месяца.

Правило из rules.yaml → seasonal_schedule: опция доступна, если самый слабый месяц
ниже 50% средней выручки; в слабый месяц платёж не ниже 30% обычного аннуитетного.
Сумма дисконтированных платежей равна сумме кредита — банк получает то же, клиент
платит больше в сезон и меньше в межсезонье. Чистая функция без БД.
"""

from __future__ import annotations

from datetime import date


def annuity_payment(principal: float, rate_pct: float, n: int) -> float:
    i = rate_pct / 100 / 12
    return principal / n if i == 0 else principal * i / (1 - (1 + i) ** -n)


def month_weights(months: list[str], revenue: list[float]) -> dict[int, float]:
    """Календарный месяц (1..12) -> выручка относительно средней. Нет данных за месяц — 1.0."""
    by_month: dict[int, list[float]] = {}
    for ym, value in zip(months, revenue, strict=True):
        by_month.setdefault(int(ym[5:7]), []).append(value)
    avg = sum(revenue) / len(revenue) if revenue else 0
    if not avg:
        return {m: 1.0 for m in range(1, 13)}
    return {m: (sum(by_month[m]) / len(by_month[m]) / avg if m in by_month else 1.0) for m in range(1, 13)}


def is_available(months: list[str], revenue: list[float], rules: dict) -> bool:
    w = month_weights(months, revenue)
    return min(w.values()) < rules["seasonal_schedule"]["enabled_if_min_month_share_below"]


def _add_months(d: date, k: int) -> date:
    y, m = divmod(d.month - 1 + k, 12)
    return date(d.year + y, m + 1, 1)


def _pv(payments: list[float], i: float) -> float:
    return sum(p / (1 + i) ** (t + 1) for t, p in enumerate(payments))


def build(
    principal: float,
    rate_pct: float,
    term: int,
    months: list[str],
    revenue: list[float],
    first_payment: date,
    rules: dict,
) -> dict:
    """График: список месяцев с платежом, процентами, телом и остатком; сравнение с аннуитетом."""
    i = rate_pct / 100 / 12
    annuity = annuity_payment(principal, rate_pct, term)
    floor = annuity * rules["seasonal_schedule"]["min_payment_share"]
    w = month_weights(months, revenue)
    dates = [_add_months(first_payment, t) for t in range(term)]
    weights = [w[d.month] for d in dates]

    def payments(k: float) -> list[float]:
        return [max(k * wt, floor) for wt in weights]

    lo, hi = 0.0, annuity * 10
    for _ in range(100):  # бисекция по множителю: PV(платежей) = сумма кредита
        mid = (lo + hi) / 2
        if _pv(payments(mid), i) < principal:
            lo = mid
        else:
            hi = mid
    pays = [round(p) for p in payments(hi)]

    rows, balance = [], float(principal)
    for t, (d, p) in enumerate(zip(dates, pays, strict=True)):
        interest = balance * i
        if t == term - 1:
            p = round(balance + interest)  # последний платёж закрывает копеечный остаток округлений
        body = p - interest
        balance = balance - body
        rows.append(
            {
                "date": d.isoformat(),
                "payment": p,
                "interest": round(interest),
                "principal": round(body),
                "balance": max(0, round(balance)),
            }
        )
    total = sum(r["payment"] for r in rows)
    return {
        "schedule": rows,
        "annuity_payment": round(annuity),
        "max_payment": max(r["payment"] for r in rows),
        "min_payment": min(r["payment"] for r in rows),
        "overpayment": round(total - principal),
        "annuity_overpayment": round(annuity * term - principal),
        "peak_months": sorted(m for m, v in w.items() if v >= 1.2),
        "low_months": sorted(m for m, v in w.items() if v < 0.6),
    }
