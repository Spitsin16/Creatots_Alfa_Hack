"""Объяснения решения словами — шаблоны без LLM.

Чистые функции: на вход результат `scoring.engine.decide` и правила, на выход текст.
Клиенту не отдаём баллы, пороги, класс и антифрод-флаги (AGENTS.md, правило 6) —
только факторы словами, его собственные цифры и советы. Банку — всё, включая баллы.
LLM, если включён, получает `facts_for_llm` и только переформулирует; цифры
в его ответе сверяются `guard.numbers_match`.
"""

from __future__ import annotations

PRODUCT_NAMES = {
    "OVERDRAFT": "овердрафт",
    "WORKING_CAPITAL": "кредит на пополнение оборотных средств",
    "CREDIT_LINE": "кредитная линия",
    "REFINANCE": "рефинансирование кредитов других банков",
}

# (фактор, знак) -> текст для клиента. Нейтральные факторы не показываем.
# Правка ментора 25.10: о прошлых просрочках клиенту не напоминаем — он о них знает,
# а фраза раздражает. Банк видит фактор в карточке; клиенту вместо упрёка — совет
# PAY_ON_TIME («платите без просрочек — пересмотр через 6 месяцев»). Минусы звучат
# как «что сдерживает сумму», а не как оценка бизнеса.
FACTOR_TEXT = {
    ("BUSINESS_AGE", +1): "бизнес работает давно",
    ("BUSINESS_AGE", -1): "бизнесу меньше полугода",
    ("REVENUE_STABILITY", +1): "выручка стабильная от месяца к месяцу",
    ("REVENUE_STABILITY", -1): "выручка заметно меняется от месяца к месяцу",
    ("DEBT_LOAD", +1): "текущие платежи по кредитам небольшие относительно выручки",
    ("DEBT_LOAD", -1): "часть выручки уже идёт на платежи по текущим кредитам",
    ("CREDIT_HISTORY", +1): "кредиты за последний год платились без просрочек",
    ("ALFA_HISTORY", +1): "вы уже аккуратно платили по кредитам в Альфе",
    ("TAX_DEBT", -1): "есть незакрытый налоговый долг",
    ("INDUSTRY_RISK", +1): "отрасль бизнеса устойчивая",
    ("INDUSTRY_RISK", -1): "в вашей отрасли банк осторожнее с лимитами",
    ("ALFA_SHARE", +1): "основные обороты идут через Альфу",
    ("ALFA_SHARE", -1): "часть оборотов идёт через другие банки — мы её не видим",
    ("DATA_QUALITY", +1): "в Альфе есть полная история оборотов за год",
    ("DATA_QUALITY", -1): "в Альфе пока меньше года оборотов — данных для расчёта меньше",
}

# Для банка: человеческое название фактора.
FACTOR_LABEL = {
    "BUSINESS_AGE": "Срок работы бизнеса",
    "REVENUE_STABILITY": "Стабильность выручки",
    "DEBT_LOAD": "Долговая нагрузка",
    "CREDIT_HISTORY": "Кредитная история (БКИ)",
    "ALFA_HISTORY": "История в Альфе",
    "TAX_DEBT": "Налоговая задолженность",
    "INDUSTRY_RISK": "Отраслевой риск",
    "ALFA_SHARE": "Доля оборотов в Альфе",
    "DATA_QUALITY": "Полнота данных",
}

BINDING_LABEL = {
    "REVENUE": "от выручки",
    "CAPACITY": "по платёжеспособности",
    "REFINANCE_BALANCE": "по остатку рефинансируемого долга",
    "PRODUCT_MAX": "максимум продукта",
}

# Причины ручной проверки / отказа без стоп-фактора. Антифрод (MASS_ADDRESS) — общей фразой.
REASON_CLIENT_TEXT = {
    "CLASS_D": "Заявку посмотрит специалист банка — так бывает, когда по данным не всё однозначно.",
    "AMOUNT_ABOVE_AUTO": "Сумма крупная, поэтому решение принимают двое: андеррайтер и риск-менеджер.",
    "MASS_ADDRESS": "Нужна дополнительная проверка данных — специалист банка займётся ею в течение срока заявки.",
    "CLASS_E": "Сейчас мы не можем выдать кредит по совокупности факторов.",
    "NO_CAPACITY": "С учётом текущих платежей по кредитам новый платёж будет вам не по силам.",
}

REASON_BANK_TEXT = {
    "CLASS_D": "Класс D — ручное рассмотрение",
    "AMOUNT_ABOVE_AUTO": "Сумма выше порога автоодобрения — нужно второе одобрение риск-менеджера",
    "MASS_ADDRESS": "Адрес массовой регистрации",
    "CLASS_E": "Класс E — отказ по скорингу",
    "NO_CAPACITY": "Нет платёжеспособности под новый платёж, рефинансирование не снижает нагрузку",
}

HEADLINE = {
    "APPROVED": "Можем выдать {product} на {amount}",
    "COUNTER_OFFER": "Запрошенную сумму выдать не можем — предлагаем другой вариант",
    "MANUAL_REVIEW": "Предварительно — до {amount}, финальное решение за специалистом",
    "REJECTED": "Сейчас выдать кредит не можем",
}


def rub(value: float | int | None) -> str:
    """1234567.8 -> '1 234 568 ₽' (неразрывный пробел между разрядами не используем — проще сверять)."""
    if value is None:
        return "—"
    return f"{round(value):,} ₽".replace(",", " ")


def pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",") + "%"


def _monthly_payments(decision: dict) -> float:
    return (decision.get("debt_load") or 0) * (decision.get("avg_revenue") or 0)


def why_amount(decision: dict) -> str | None:
    """Почему такая сумма — по ограничению, которое оказалось самым жёстким."""
    binding = decision.get("binding_constraint")
    avg, months = decision.get("avg_revenue"), decision.get("months")
    limit = decision.get("limit") or 0
    if binding == "REVENUE":
        return (
            f"Сумму считаем от вашей средней выручки — {rub(avg)} в месяц за последние {months} мес. "
            f"Для этого продукта и вашего профиля это даёт до {rub(limit)}."
        )
    if binding == "CAPACITY":
        pay = _monthly_payments(decision)
        if limit <= 0:
            return (
                f"Сейчас по кредитам уходит {rub(pay)} в месяц при выручке {rub(avg)} — "
                "места под ещё один платёж не остаётся."
            )
        tail = f", с учётом текущих платежей {rub(pay)} в месяц" if pay else ""
        return (
            f"Сумма ограничена тем, чтобы платёж был посильным: выручка {rub(avg)} в месяц{tail}. "
            f"Максимум — {rub(limit)}."
        )
    if binding == "REFINANCE_BALANCE":
        return f"Сумма равна остатку долга в других банках, который мы перекрываем, — {rub(limit)}."
    if binding == "PRODUCT_MAX":
        return f"Это максимальная сумма по продукту без залога — {rub(limit)}."
    return None


def factors_for_client(decision: dict) -> dict:
    strengths, weaknesses = [], []
    for code, points in (decision.get("factors") or {}).items():
        if code == "ALFA_SHARE" and (decision.get("alfa_share") or 1) < 0.9:
            points = -1  # частичная доля: для клиента это повод перевести обороты, а не плюс
        if points > 0 and (code, +1) in FACTOR_TEXT:
            strengths.append(FACTOR_TEXT[(code, +1)])
        elif points < 0 and (code, -1) in FACTOR_TEXT:
            weaknesses.append(FACTOR_TEXT[(code, -1)])
    return {"strengths": strengths, "weaknesses": weaknesses}


def advice_for_client(decision: dict) -> list[dict]:
    out = []
    for a in decision.get("advice") or []:
        parts = []
        if a.get("delta_limit", 0) > 0:
            parts.append(f"сумма вырастет до {rub(a['new_limit'])}")
        if a.get("new_rate") is not None and decision.get("rate") is not None and a["new_rate"] < decision["rate"]:
            parts.append(f"ставка снизится до {pct(a['new_rate'])}")
        effect = (". Тогда " + " и ".join(parts)) if parts else ""
        item = {
            "code": a["code"],
            "text": a["text"] + effect,
            "new_limit": a.get("new_limit"),
            "new_rate": a.get("new_rate"),
        }
        if a.get("costs"):
            item["costs"] = a["costs"]
        out.append(item)
    return out


def _stop_text(rules: dict, code: str, context: dict) -> str:
    for s in rules.get("stop_factors", []):
        if s["code"] == code:
            text = s["client_text"]
            for key, value in context.items():
                text = text.replace("{" + key + "}", str(value))
            # незаполненные плейсхолдеры не показываем клиенту
            while "{" in text and "}" in text:
                start, end = text.index("{"), text.index("}")
                text = (text[:start].rstrip() + text[end + 1 :]).replace(" .", ".")
            return text
    return REASON_CLIENT_TEXT.get(code, "Сейчас выдать кредит не можем.")


def counter_text(decision: dict) -> str | None:
    c = decision.get("counter")
    if not c:
        return None
    name = PRODUCT_NAMES.get(c["product"], c["product"])
    if c["product"] == "REFINANCE" and c.get("old_payment"):
        return (
            f"Вместо нового кредита предлагаем {name}: {rub(c['amount'])} на {c['term']} мес. "
            f"под {pct(c['rate'])}. Платёж снизится с {rub(c['old_payment'])} до {rub(c['new_payment'])} "
            f"в месяц — экономия {rub(c['saving_per_month'])} в месяц."
        )
    return f"Можем выдать {name} на {rub(c['amount'])} на {c['term']} мес."


def explain_for_client(decision: dict, rules: dict, context: dict | None = None) -> dict:
    """Всё, что видит клиент на экране предложения/решения."""
    outcome = decision.get("outcome")
    product = PRODUCT_NAMES.get(decision.get("product"), decision.get("product"))
    amount = decision.get("limit") or 0
    if outcome == "APPROVED":
        amount = min(decision.get("requested") or amount, amount)
    headline = HEADLINE.get(outcome, "").format(product=product, amount=rub(amount))
    res = {
        "outcome": outcome,
        "headline": headline,
        "product": product,
        "why_amount": None,
        "reason": None,
        "counter": counter_text(decision),
        "counter_terms": decision.get("counter"),
        **factors_for_client(decision),
        "advice": advice_for_client(decision),
    }
    if decision.get("stop_factors"):
        res["reason"] = _stop_text(rules, decision["stop_factors"][0], context or {})
        res["strengths"] = []  # при стоп-факторе плюсы не важны и только путают
        return res
    res["why_amount"] = why_amount(decision)
    if outcome in ("MANUAL_REVIEW", "REJECTED") and decision.get("reason"):
        res["reason"] = REASON_CLIENT_TEXT.get(decision["reason"])
    if decision.get("rate") is not None and outcome not in ("REJECTED", "COUNTER_OFFER"):
        terms = f"Ставка {pct(decision['rate'])}"
        if decision.get("payment"):
            terms += f", платёж {rub(decision['payment'])} в месяц на {decision['term']} мес."
        res["terms"] = terms
    return res


def explain_for_bank(decision: dict) -> dict:
    """Карточка андеррайтера: баллы по факторам, кандидаты лимита, причина маршрута."""
    factors = [
        {"code": code, "label": FACTOR_LABEL.get(code, code), "points": points}
        for code, points in (decision.get("factors") or {}).items()
    ]
    factors.sort(key=lambda f: f["points"])
    cands = decision.get("limit_candidates") or {}
    return {
        "score": decision.get("score"),
        "class": decision.get("cls"),
        "factors": factors,
        "limit_candidates": [
            {
                "code": k,
                "label": BINDING_LABEL.get(k, k),
                "amount": v,
                "binding": k == decision.get("binding_constraint"),
            }
            for k, v in cands.items()
        ],
        "reason": decision.get("reason"),
        "reason_text": REASON_BANK_TEXT.get(decision.get("reason") or "", decision.get("reason")),
        "stop_factors": decision.get("stop_factors") or [],
        "flags": decision.get("flags") or [],
    }


def facts_for_llm(decision: dict, rules: dict, context: dict | None = None) -> dict:
    """Факты для LLM-переформулировки: только то, что можно показать клиенту."""
    client = explain_for_client(decision, rules, context)
    return {
        "headline": client["headline"],
        "why_amount": client["why_amount"],
        "reason": client["reason"],
        "counter": client["counter"],
        "strengths": client["strengths"],
        "weaknesses": client["weaknesses"],
        "advice": [a["text"] for a in client["advice"]],
        "terms": client.get("terms"),
    }
