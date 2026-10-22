"""Детерминированный расчёт кредитного предложения из версионированных правил.

Начальная реализация сверяется с зафиксированным эталоном expected.json.
"""
import statistics
from collections import defaultdict
from datetime import date, timedelta

AS_OF = date(2026, 10, 22)


# ------------------------------------------------------------------ утилиты
def months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month) - (1 if b.day < a.day else 0)


def annuity_payment(principal, rate_pct, n):
    r = rate_pct / 100 / 12
    return principal * r / (1 - (1 + r) ** -n)


def annuity_principal(payment, rate_pct, n):
    if payment <= 0:
        return 0.0
    r = rate_pct / 100 / 12
    return payment * (1 - (1 + r) ** -n) / r


def band(value, bands):
    for b in bands:
        if "lt" in b and value < b["lt"]:
            return b["points"]
        if "lte" in b and value <= b["lte"]:
            return b["points"]
        if "eq" in b and value == b["eq"]:
            return b["points"]
        if "gte" in b and value >= b["gte"]:
            return b["points"]
        if "gt" in b and value > b["gt"]:
            return b["points"]
    return 0


def rdown(x, step):
    return int(max(0, x) // step * step)


# ------------------------------------------------------------------ входные величины
def derive(p, extra_statement_revenue=None, overrides=None):
    """Считает всё, что нужно скорингу. overrides — для what-if."""
    o = overrides or {}
    tx = p["alfa"]["transactions"]
    opened = date.fromisoformat(p["alfa"]["account"]["opened"])
    # полные месяцы истории, после открытия счёта
    last_full = date(AS_OF.year, AS_OF.month, 1) - timedelta(days=1)
    months = []
    m = date(last_full.year, last_full.month, 1)
    while len(months) < 12:
        if m <= opened.replace(day=1) and opened.day > 1:
            break
        if m < opened.replace(day=1):
            break
        months.append((m.year, m.month))
        m = (m - timedelta(days=1)).replace(day=1)
    months.reverse()
    rev = defaultdict(float)
    own_other = defaultdict(float)
    for t in tx:
        y, mo = int(t["date"][:4]), int(t["date"][5:7])
        if (y, mo) not in months:
            continue
        if t["direction"] == "IN" and t["kind"] == "REVENUE":
            rev[(y, mo)] += t["amount"]
        if t["direction"] == "IN" and t["kind"] == "OWN_TRANSFER" and "р/с в" in t["purpose"]:
            own_other[(y, mo)] += t["amount"]
    monthly = [rev[k] for k in months]
    alfa_avg = statistics.mean(monthly) if monthly else 0.0
    cv = statistics.pstdev(monthly) / alfa_avg if len(monthly) >= 2 and alfa_avg else None
    own_other_avg = statistics.mean([own_other[k] for k in months]) if months else 0.0

    avg_revenue = alfa_avg + (extra_statement_revenue or 0.0)
    fns_rev = p["fns"].get("annual_revenue", {}).get("2025")
    if fns_rev:
        alfa_share = min(1.0, alfa_avg * 12 / fns_rev)
    elif own_other_avg > 0:
        alfa_share = alfa_avg / (alfa_avg + own_other_avg)
    else:
        alfa_share = 1.0
    alfa_share = o.get("alfa_share", alfa_share)
    if "avg_revenue" in o:
        avg_revenue = o["avg_revenue"]

    alfa_pay = sum(c["monthly_payment"] for c in p["alfa"]["credits"] if c["status"] == "ACTIVE")
    ext = p["bki"]["external"]
    ext_pay = sum(e["monthly_payment"] for e in ext)
    ext_pay = o.get("ext_pay", ext_pay)
    payments = alfa_pay + ext_pay

    reg = date.fromisoformat(p["registry"]["reg_date"])
    age = o.get("age_months", months_between(reg, AS_OF))

    bki = p["bki"]
    if not bki["has_history"] and not p["alfa"]["credits"]:
        ch = "NO_HISTORY"
    elif bki["past_max_overdue_days_12m"] >= 30:
        ch = "PAST_OVERDUE_GTE_30"
    elif bki["past_max_overdue_days_12m"] > 0:
        ch = "PAST_OVERDUE_LT_30"
    else:
        ch = "CLEAN_12M"
    ch = o.get("credit_history", ch)
    if not p["alfa"]["credits"]:
        ah = "NOT_BORROWER"
    elif any(c["max_overdue_days"] > 0 for c in p["alfa"]["credits"]):
        ah = "HAD_OVERDUE"
    else:
        ah = "GOOD_BORROWER"
    dq = "ALFA_12M" if len(months) >= 12 else "ALFA_LT_12M"
    if extra_statement_revenue:
        dq = "STATEMENT_12M" if len(months) >= 12 else dq
    return dict(
        months=[f"{y}-{mo:02d}" for y, mo in months], monthly_revenue=[round(x) for x in monthly],
        avg_revenue=avg_revenue, alfa_avg=alfa_avg, cv=cv, own_other_avg=own_other_avg,
        alfa_share=alfa_share, alfa_payments=alfa_pay, ext_payments=ext_pay, payments=payments,
        debt_load=payments / avg_revenue if avg_revenue else 1.0, age_months=age,
        credit_history=ch, alfa_history=ah, tax_debt=o.get("tax_debt", p["fns"]["tax_debt"]),
        okved2=p["registry"]["okved"][:2], data_quality=dq,
        min_month_share=(min(monthly) / alfa_avg) if monthly and alfa_avg else 1.0,
    )


# ------------------------------------------------------------------ скоринг
def score(rules, d):
    f = rules["scoring"]["factors"]
    pts = {}
    pts["BUSINESS_AGE"] = band(d["age_months"], f["BUSINESS_AGE"]["bands"])
    pts["REVENUE_STABILITY"] = band(d["cv"], f["REVENUE_STABILITY"]["bands"]) if d["cv"] is not None else 0
    pts["DEBT_LOAD"] = band(d["debt_load"], f["DEBT_LOAD"]["bands"])
    pts["CREDIT_HISTORY"] = f["CREDIT_HISTORY"]["values"][d["credit_history"]]
    pts["ALFA_HISTORY"] = f["ALFA_HISTORY"]["values"][d["alfa_history"]]
    pts["TAX_DEBT"] = band(d["tax_debt"], f["TAX_DEBT"]["bands"])
    g = f["INDUSTRY_RISK"]["okved_groups"]
    grp = "low" if d["okved2"] in g["low"] else "high" if d["okved2"] in g["high"] else "medium"
    pts["INDUSTRY_RISK"] = f["INDUSTRY_RISK"]["values"][grp]
    pts["ALFA_SHARE"] = band(d["alfa_share"], f["ALFA_SHARE"]["bands"])
    pts["DATA_QUALITY"] = f["DATA_QUALITY"]["values"][d["data_quality"]]
    total = rules["scoring"]["base"] + sum(pts.values())
    cls = next(c for c in rules["classes"] if total >= c["min"])
    return total, cls, pts


def stop_factors(p, d):
    out = []
    if d["age_months"] < 3:
        out.append("BUSINESS_TOO_YOUNG")
    if p["registry"]["status"] in ("LIQUIDATING", "CLOSED"):
        out.append("LIQUIDATION")
    if p["registry"].get("bankruptcy"):
        out.append("BANKRUPTCY")
    if p["bki"]["current_overdue_days"] >= 30:
        out.append("CURRENT_OVERDUE")
    if p["fns"]["account_block"]:
        out.append("TAX_ACCOUNT_BLOCK")
    if p["registry"].get("address_invalid"):
        out.append("INVALID_LEGAL_ADDRESS")
    return out


def rate_for(rules, product, cls, alfa_share, secured=False):
    pr = rules["products"][product]
    disc = 0.0
    for b in rules["rate"]["alfa_share_discount"]:
        if alfa_share >= b["gte"]:
            disc = b["pp"]
            break
    r = pr["base_rate"] + (cls["rate_premium"] or 0) - disc - (rules["rate"]["collateral_discount_pp"] if secured else 0)
    return max(r, rules["market"]["key_rate"] + rules["market"]["rate_floor_over_key"])


def limit_for(rules, product, cls, d, term, rate, refinance_balance=None):
    pr = rules["products"][product]
    step = rules["limit"]["round_down_to"]
    cands = {}
    if pr["revenue_coef"] is not None:
        cands["REVENUE"] = d["avg_revenue"] * pr["revenue_coef"] * cls["limit_coef"]
    if refinance_balance is not None:
        cands["REFINANCE_BALANCE"] = refinance_balance
    if pr["capacity_check"]:
        free = d["avg_revenue"] * rules["debt_load"]["max_payment_share"] - d["payments"]
        if product == "REFINANCE":
            free += d["ext_payments"]  # рефинансируемый платёж уходит
        cands["CAPACITY"] = annuity_principal(free, rate, term)
    cands["PRODUCT_MAX"] = pr["max_amount"]
    binding = min(cands, key=cands.get)
    return rdown(cands[binding], step), binding, {k: round(v) for k, v in cands.items()}


# ------------------------------------------------------------------ решение
def decide(rules, p, extra_statement_revenue=None, overrides=None, scenario=None, with_advice=True):
    sc = scenario or p["persona"]["scenario"]
    d = derive(p, extra_statement_revenue, overrides)
    stops = stop_factors(p, d)
    total, cls, pts = score(rules, d)
    product = rules["product_choice"]["by_purpose"][sc["purpose"]]
    if sc["purpose"] not in ("refinance",) and sc.get("frequency") in rules["product_choice"]["by_frequency_override"]:
        product = rules["product_choice"]["by_frequency_override"][sc["frequency"]]
    pr = rules["products"][product]
    term = min(max(sc["term_months"], pr["term_months"]["min"]), pr["term_months"]["max"])
    res = dict(id=p["persona"]["id"], score=total, cls=cls["name"], factors=pts, product=product, term=term,
               avg_revenue=round(d["avg_revenue"]), debt_load=round(d["debt_load"], 3),
               alfa_share=round(d["alfa_share"], 3), cv=round(d["cv"], 3) if d["cv"] is not None else None,
               months=len(d["months"]), stop_factors=stops, requested=sc["amount"])
    if stops:
        res.update(outcome=next(s["outcome"] for s in rules["stop_factors"] if s["code"] == stops[0]),
                   reason=stops[0], limit=0, rate=None)
        return res
    if cls["route"] == "REJECTED":
        res.update(outcome="REJECTED", reason="CLASS_E", limit=0, rate=None)
        return res
    rate = rate_for(rules, product, cls, d["alfa_share"])
    ref_bal = None
    if product == "REFINANCE":
        ref_bal = sum(e["balance"] for e in p["bki"]["external"])
    limit, binding, cands = limit_for(rules, product, cls, d, term, rate, ref_bal)
    res.update(rate=rate, limit=limit, binding_constraint=binding, limit_candidates=cands)
    if product != "OVERDRAFT":
        amt = min(sc["amount"], limit) if limit else sc["amount"]
        res["payment"] = round(annuity_payment(amt, rate, term))
        res["overpayment"] = round(res["payment"] * term - amt)
    flags = []
    if sc["amount"] > rules["outcome"]["risk_manager_above"]:
        flags.append("AMOUNT_ABOVE_AUTO")
    if p["registry"].get("mass_address"):
        flags.append("MASS_ADDRESS")
    if cls["route"] == "MANUAL_REVIEW" or flags:
        res.update(outcome="MANUAL_REVIEW", reason=("CLASS_D" if cls["route"] == "MANUAL_REVIEW" else flags[0]),
                   flags=flags)
    elif sc["amount"] <= limit:
        res.update(outcome="APPROVED")
    elif limit >= pr["min_amount"]:
        res.update(outcome="COUNTER_OFFER", counter=dict(product=product, amount=limit, term=term))
    else:
        res.update(outcome=None)
        # рефинансирование как контрпредложение
        if p["bki"]["external"] and product != "REFINANCE":
            ref_cls = cls
            r2 = rate_for(rules, "REFINANCE", ref_cls, d["alfa_share"])
            bal = sum(e["balance"] for e in p["bki"]["external"])
            t2 = rules["products"]["REFINANCE"]["term_months"]["max"]
            new_pay = annuity_payment(bal, r2, t2)
            if new_pay < d["ext_payments"]:
                res.update(outcome="COUNTER_OFFER",
                           counter=dict(product="REFINANCE", amount=rdown(bal, 10000), term=t2, rate=r2,
                                        new_payment=round(new_pay), old_payment=d["ext_payments"],
                                        saving_per_month=round(d["ext_payments"] - new_pay)))
        if res["outcome"] is None:
            res.update(outcome="REJECTED", reason="NO_CAPACITY")
    # сезонный график
    res["seasonal_available"] = (d["min_month_share"] < rules["seasonal_schedule"]["enabled_if_min_month_share_below"]
                                 and product in ("WORKING_CAPITAL", "CREDIT_LINE", "REFINANCE"))
    if with_advice:
        res["advice"] = advice(rules, p, d, sc, res)
    return res


def advice(rules, p, d, sc, base):
    """What-if: пересчитываем лимит при улучшении фактора, показываем только рост."""
    base_limit = base.get("limit", 0) or 0
    out = []

    def try_(code, text, **kw):
        r = decide(rules, p, with_advice=False, scenario=sc, **kw)
        nl = r.get("limit", 0) or 0
        if nl > base_limit or (r.get("rate") and base.get("rate") and r["rate"] < base["rate"]):
            out.append(dict(code=code, text=text, new_limit=nl, new_rate=r.get("rate"),
                            delta_limit=nl - base_limit))

    ext = p["bki"]["external"]
    if ext:
        try_("REPAY_EXTERNAL", f"Погасите кредит в {ext[0]['bank']} (остаток {ext[0]['balance']:,} ₽)".replace(",", " "),
             overrides=dict(ext_pay=0))
    if d["alfa_share"] < 0.9:
        if d["own_other_avg"] > 0:
            # выписка: прибавляем оценку выручки в другом банке (свои переводы ≈ 60% от неё)
            try_("UPLOAD_STATEMENT", "Часть выручки идёт через другой банк — загрузите выписку оттуда",
                 extra_statement_revenue=d["own_other_avg"] / 0.6)
        try_("MOVE_TURNOVER", "Переведите обороты (эквайринг) в Альфу",
             overrides=dict(alfa_share=0.95, avg_revenue=d["alfa_avg"] / max(d["alfa_share"], 0.01)))
    if d["age_months"] < 12:
        anniv = date.fromisoformat(p["registry"]["reg_date"]).replace(year=AS_OF.year + (1 if date.fromisoformat(p["registry"]["reg_date"]).replace(year=AS_OF.year) <= AS_OF else 0))
        try_("WAIT_ANNIVERSARY", f"{anniv.strftime('%d.%m.%Y')} бизнесу исполнится год", overrides=dict(age_months=12))
    if d["tax_debt"] > 0:
        try_("PAY_TAX_DEBT", f"Закройте налоговый долг {d['tax_debt']:,} ₽".replace(",", " "), overrides=dict(tax_debt=0))
    if p["alfa"]["credits"] and d["credit_history"] != "CLEAN_12M":
        try_("PAY_ON_TIME", "Платите без просрочек — пересмотр через 6 месяцев",
             overrides=dict(credit_history="CLEAN_12M"))
    # залог: отдельный расчёт
    assets = [a for a in sc.get("assets", []) if a != "none"]
    if assets and base.get("product") != "OVERDRAFT" and base.get("outcome") != "REJECTED":
        owned = p["persona"].get("assets_owned") or []
        value = owned[0]["value"] if owned else None
        if value:
            ltv = rules["collateral"]["ltv"][assets[0]]
            cls = next(c for c in rules["classes"] if c["name"] == base["cls"])
            prod = base["product"]
            r_sec = rate_for(rules, prod, cls, d["alfa_share"], secured=True)
            t = rules["collateral"]["secured_max_term_months"]
            free = d["avg_revenue"] * rules["debt_load"]["max_payment_share"] - d["payments"] + (d["ext_payments"] if prod == "REFINANCE" else 0)
            cap = annuity_principal(free, r_sec, t)
            new_lim = rdown(min(cap, base_limit + value * ltv, rules["collateral"]["secured_max_amount"]), 10000)
            if prod == "REFINANCE":
                new_lim = base_limit  # рефинансирование ограничено остатком долга: залог даёт только ставку
            out.append(dict(code="ADD_COLLATERAL", text=f"Оформите в залог: {owned[0]['title']} (оценка ~{value:,} ₽)".replace(",", " "),
                            new_limit=new_lim, new_rate=r_sec, delta_limit=new_lim - base_limit,
                            costs=rules["collateral"]["costs_text"]))
    out.sort(key=lambda a: -a["delta_limit"])
    return out[:3]


# ------------------------------------------------------------------ прогноз кассового разрыва
def cashflow_forecast(p, days=30):
    tx = p["alfa"]["transactions"]
    end = date.fromisoformat(p["alfa"]["account"]["balance_as_of"])
    start90 = end - timedelta(days=89)
    recent = [t for t in tx if date.fromisoformat(t["date"]) >= start90]
    # регулярные списания: один получатель, ≥3 раза за 120 дней, день месяца ±3, сумма ±15%
    by_cp = defaultdict(list)
    for t in tx:
        if t["direction"] == "OUT" and date.fromisoformat(t["date"]) >= end - timedelta(days=119) and t["kind"] not in ("OWNER_WITHDRAWAL",):
            by_cp[(t["counterparty"], t["kind"])].append(t)
    recurring = []
    for (cp, kind), items in by_cp.items():
        if len(items) >= 3:
            # несколько платежей в месяц одному получателю (зарплата 10 и 25) — группируем по дню
            groups = defaultdict(list)
            for i in items:
                dd = date.fromisoformat(i["date"]).day
                key = next((g for g in groups if abs(g - dd) <= 3), dd)
                groups[key].append(i)
            for dd, its in groups.items():
                a = [i["amount"] for i in its]
                if len(its) >= 3 and statistics.pstdev(a) / statistics.mean(a) <= 0.15:
                    recurring.append(dict(counterparty=cp, kind=kind, day=dd, amount=round(statistics.mean(a))))
            # квартальные (налог): 2+ раза с шагом ~90 дней
        if kind == "TAX" and len(items) >= 1:
            pass
    taxes = [t for t in tx if t["kind"] == "TAX"]
    rec_cps = {(r["counterparty"], r["kind"]) for r in recurring}
    # средние поступления по дню недели и средние нерегулярные расходы в день
    inflow_wd = defaultdict(list)
    d = start90
    while d <= end:
        inflow_wd[d.weekday()].append(sum(t["amount"] for t in recent if t["date"] == d.isoformat()
                                          and t["direction"] == "IN" and t["kind"] in ("REVENUE",)
                                          or (t["date"] == d.isoformat() and t["kind"] == "OWN_TRANSFER" and "р/с в" in t.get("purpose", ""))))
        d += timedelta(days=1)
    avg_in = {k: statistics.mean(v) for k, v in inflow_wd.items()}
    irregular_out = sum(t["amount"] for t in recent if t["direction"] == "OUT"
                        and (t["counterparty"], t["kind"]) not in rec_cps
                        and t["kind"] in ("SUPPLIER", "OTHER")) / 90
    bal = p["alfa"]["account"]["balance"]
    series = []
    worst = (bal, end)
    reasons = {}
    for i in range(1, days + 1):
        day = end + timedelta(days=i)
        inflow = avg_in.get(day.weekday(), 0)
        outs = [r for r in recurring if r["day"] == day.day]
        if day.day == 28 and day.month in (1, 4, 7, 10) and taxes:
            outs.append(dict(counterparty="ФНС", kind="TAX", day=28, amount=round(statistics.mean(t["amount"] for t in taxes))))
        out_sum = sum(r["amount"] for r in outs) + irregular_out
        bal = bal + inflow - out_sum
        series.append(dict(date=day.isoformat(), balance=round(bal)))
        if outs:
            reasons[day.isoformat()] = [f"{r['counterparty']} — {r['amount']:,} ₽".replace(",", " ") for r in outs]
        if bal < worst[0]:
            worst = (bal, day)
    gap = None
    if worst[0] < 0:
        gap = dict(date=worst[1].isoformat(), shortfall=round(-worst[0]),
                   overdraft_suggestion=rdown(-worst[0] * 1.1 + 9999, 10000),
                   reasons=reasons.get(worst[1].isoformat(), []))
    return dict(start_balance=p["alfa"]["account"]["balance"], recurring=recurring,
                avg_daily_inflow=round(statistics.mean(avg_in.values())), avg_daily_irregular_out=round(irregular_out),
                gap=gap, series=series)
