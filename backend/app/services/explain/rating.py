"""Рейтинг бизнеса «A 90» простыми словами — для сотрудника банка (клиенту не отдаётся).

Рейтинг = класс риска (буква) + балл. Балл — сумма: база 40 + факторы (от −20 до +10
каждый), поэтому шкала не от 0 до 100. Класс задаёт условия: какая доля
расчётного лимита доступна, надбавка к ставке и кто решает. Балл показывает,
насколько уверенно бизнес держится в своём классе: сколько не хватает до
следующего и какой запас до предыдущего. Все пороги — из версии правил решения.
"""

from __future__ import annotations

MEANING = {
    "A": "Надёжный заёмщик",
    "B": "Хороший заёмщик",
    "C": "Средний риск",
    "D": "Пограничный риск",
    "E": "Высокий риск",
}
ROUTE = {
    "AUTO": "решение принимается автоматически",
    "MANUAL_REVIEW": "решение принимает андеррайтер",
    "REJECTED": "автоматический отказ",
}


def _points(n: int) -> str:
    n = abs(n)
    word = "балл" if n % 10 == 1 and n % 100 != 11 else (
        "балла" if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else "баллов")
    return f"{n} {word}"


def score_range(rules: dict) -> tuple[int, int]:
    """Теоретические минимум и максимум балла по текущим правилам."""
    base = rules["scoring"]["base"]
    lo = hi = base
    for factor in rules["scoring"]["factors"].values():
        if "bands" in factor:
            values = [b["points"] for b in factor["bands"]]
        else:
            values = list(factor["values"].values())
        lo += min(values)
        hi += max(values)
    return lo, hi


def explain_rating(cls: str, score: int, rules: dict) -> dict:
    classes = sorted(rules["classes"], key=lambda c: c["min"], reverse=True)
    idx = next(i for i, c in enumerate(classes) if c["name"] == cls)
    current = classes[idx]
    lo, hi = score_range(rules)
    if current["route"] == "REJECTED":
        conditions = "кредит не выдаём"
    else:
        share = round(current["limit_coef"] * 100)
        premium = current["rate_premium"] or 0
        conditions = (f"{share}% расчётного лимита, "
                      + (f"ставка +{premium} п.п." if premium else "базовая ставка"))
    up = classes[idx - 1] if idx > 0 else None
    down = classes[idx + 1] if idx + 1 < len(classes) else None
    position = []
    if up:
        position.append(f"до класса {up['name']} не хватает {_points(up['min'] - score)}")
    if down:
        margin = score - current["min"]
        position.append(f"запас над порогом класса — {_points(margin)}: при {current['min'] - 1} и ниже — "
                        f"класс {down['name']}" if margin else f"ровно на пороге: на балл ниже — класс {down['name']}")
    return {
        "cls": cls,
        "score": score,
        "title": MEANING.get(cls, f"Класс {cls}"),
        "conditions": conditions,
        "route": ROUTE.get(current["route"], current["route"]),
        "position": "; ".join(p for p in position if p),
        "scale": f"шкала от {lo} до {hi}: база {rules['scoring']['base']} плюс факторы".replace("-", "−"),
        "summary": f"{cls} {score} — {MEANING.get(cls, '').lower()}: {conditions}, {ROUTE.get(current['route'], '')}.",
    }
