"""Песочница проверяющего: синтетический клиент по параметрам.

Проверяющий играет роль банка и источников данных — задаёт, что Альфа, ФНС и БКИ
знают о бизнесе. Генератор строит 12 месяцев движений по счёту, кредиты, ФНС и БКИ
в том же формате, что и эталонные персоны (`data/reference/generate_personas.py`,
логика транзакций перенесена оттуда). Дальше клиент проходит обычный путь, а решение
считает тот же движок. Чистые функции, без БД.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, timedelta

AS_OF = date(2026, 10, 22)
HISTORY_START = date(2025, 10, 1)
HISTORY_END = AS_OF - timedelta(days=1)

SEASONS = {
    "none": [1.0] * 12,
    "moderate": [1.05, 0.9, 1.0, 1.0, 1.05, 0.95, 0.9, 0.9, 1.05, 1.1, 1.05, 1.15],
    "strong": [0.45, 0.5, 0.85, 1.1, 1.25, 1.3, 1.3, 1.25, 1.15, 1.0, 0.85, 0.7],
}
INDUSTRIES = {  # группа риска → ОКВЭД (группы — как в rules.yaml)
    "low": ("47.11", "розничная торговля"),
    "medium": ("96.02", "услуги"),
    "high": ("41.20", "строительство"),
}
ASSET_TITLES = {"real_estate": "Коммерческая недвижимость", "vehicle": "Транспорт или спецтехника",
                "equipment": "Оборудование"}
HISTORY = {"clean": (True, 0), "none": (False, 0), "past_lt30": (True, 15), "past_gte30": (True, 45)}


@dataclass
class SandboxParams:
    type: str = "IP"                 # IP | LLC
    industry: str = "medium"         # low | medium | high
    age_months: int = 36             # срок работы бизнеса
    revenue: int = 1_000_000         # средняя выручка в месяц, ₽
    seasonality: str = "none"        # none | moderate | strong
    alfa_share: float = 1.0          # доля оборотов через Альфу
    alfa_credit: str = "none"        # none | good | overdue
    external_balance: int = 0        # остаток долга в другом банке, ₽
    external_payment: int = 0        # платёж по нему в месяц, ₽
    credit_history: str = "clean"    # clean | none | past_lt30 | past_gte30
    current_overdue_days: int = 0    # текущая просрочка в БКИ
    tax_debt: int = 0                # налоговый долг, ₽
    real_estate_value: int = 0       # оценка имущества для залога, ₽ (0 — нет); имя поля — для совместимости API
    asset_kind: str = "real_estate"  # real_estate | vehicle | equipment — что за имущество


def _inn(seed: str, ip: bool) -> str:
    rnd = random.Random(seed)
    if ip:
        d = [rnd.randint(0, 9) for _ in range(10)]
        d.append(sum(a * b for a, b in zip(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8], strict=True)) % 11 % 10)
        d.append(sum(a * b for a, b in zip(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8], strict=True)) % 11 % 10)
        return "".join(map(str, d))
    d = [rnd.randint(0, 9) for _ in range(9)]
    d.append(sum(a * b for a, b in zip(d, [2, 4, 10, 3, 5, 9, 4, 6, 8], strict=True)) % 11 % 10)
    return "".join(map(str, d))


def _ogrn(seed: str, ip: bool) -> str:
    rnd = random.Random(seed + "o")
    if ip:
        body = "3" + "".join(str(rnd.randint(0, 9)) for _ in range(13))
        return body + str(int(body) % 13 % 10)
    body = "1" + "".join(str(rnd.randint(0, 9)) for _ in range(11))
    return body + str(int(body) % 11 % 10)


def _month_days(y: int, m: int) -> int:
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - date(y, m, 1)).days


def _months_ago(months: int) -> date:
    y, m = AS_OF.year, AS_OF.month - months
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, min(AS_OF.day, 28))


def segment_for(p: SandboxParams) -> str:
    has_alfa = p.alfa_credit != "none"
    has_ext = p.external_balance > 0
    if has_alfa:
        return "1Б" if has_ext else "1А"
    if has_ext:
        return "2А"
    return "3А" if p.alfa_share >= 0.9 else "3Б"


def validate(p: SandboxParams) -> None:
    checks = [
        (p.type in ("IP", "LLC"), "Тип — ИП или ООО"),
        (p.industry in INDUSTRIES, "Неизвестная отрасль"),
        (1 <= p.age_months <= 240, "Срок работы — от 1 до 240 месяцев"),
        (100_000 <= p.revenue <= 100_000_000, "Выручка — от 100 тыс. до 100 млн ₽ в месяц"),
        (p.seasonality in SEASONS, "Неизвестная сезонность"),
        (0.2 <= p.alfa_share <= 1.0, "Доля оборотов в Альфе — от 20 до 100%"),
        (p.alfa_credit in ("none", "good", "overdue"), "Неизвестный статус кредита в Альфе"),
        (0 <= p.external_balance <= 200_000_000, "Остаток долга — до 200 млн ₽"),
        (0 <= p.external_payment <= 20_000_000, "Платёж — до 20 млн ₽"),
        (not (p.external_balance and not p.external_payment), "Для кредита в другом банке укажите платёж"),
        (p.credit_history in HISTORY, "Неизвестная кредитная история"),
        (0 <= p.current_overdue_days <= 365, "Просрочка — от 0 до 365 дней"),
        (0 <= p.tax_debt <= 50_000_000, "Налоговый долг — до 50 млн ₽"),
        (0 <= p.real_estate_value <= 1_000_000_000, "Оценка имущества — до 1 млрд ₽"),
        (p.asset_kind in ASSET_TITLES, "Неизвестный вид имущества"),
    ]
    for ok, message in checks:
        if not ok:
            raise ValueError(message)


def build(p: SandboxParams, sid: str, owner_name: str) -> dict:
    """Фикстура в формате data/personas/*.json."""
    validate(p)
    ip = p.type == "IP"
    rnd = random.Random(sid)
    season = SEASONS[p.seasonality]
    other_share = round(1 - p.alfa_share, 3)
    reg = _months_ago(p.age_months)
    opened = reg + timedelta(days=5)
    okved, industry_title = INDUSTRIES[p.industry]
    rev = p.revenue
    recurring = [
        ("RENT", "ООО «Арендодатель» (аренда)", 5, rev * 0.10),
        ("SALARY", "Зарплата сотрудникам", 10, rev * 0.12),
        ("SALARY", "Зарплата сотрудникам", 25, rev * 0.12),
    ]
    alfa_credits = []
    if p.alfa_credit != "none":
        alfa_credits.append(dict(
            product="WORKING_CAPITAL", status="ACTIVE", amount=round(rev * 2, -3),
            opened=max(opened, HISTORY_START - timedelta(days=200)).isoformat(),
            balance=round(rev * 1.1, -3), monthly_payment=round(rev * 0.06, -3), rate=21.0, payment_day=15,
            max_overdue_days=20 if p.alfa_credit == "overdue" else 0,
        ))
    has_history, past_overdue = HISTORY[p.credit_history]
    external = []
    if p.external_balance > 0:
        external.append(dict(
            bank="Банк «Пример» (синтетический)", product="Кредит на развитие", balance=p.external_balance,
            monthly_payment=p.external_payment, rate=23.0,
            months_left=max(1, round(p.external_balance / max(p.external_payment, 1))),
            overdue_days=p.current_overdue_days,
        ))
        has_history = True
    bki = dict(has_history=has_history or bool(alfa_credits), current_overdue_days=p.current_overdue_days,
               past_max_overdue_days_12m=past_overdue, external=external)

    # движения по счёту за 12 полных месяцев (или с открытия счёта)
    tx, bal = [], rev * 0.5
    start = max(HISTORY_START, opened)
    noise: dict[tuple[int, int], float] = {}
    d = start
    while d <= HISTORY_END:
        y, m = d.year, d.month
        noise.setdefault((y, m), max(0.5, rnd.gauss(1.0, 0.08)))
        target = rev * season[m - 1] * noise[(y, m)]
        daily = target * p.alfa_share / _month_days(y, m)
        wk = 0.8 if d.weekday() == 0 else (1.15 if d.weekday() >= 4 else 1.0)
        amt = round(daily * wk * rnd.uniform(0.85, 1.15), -2)
        tx.append(dict(date=d.isoformat(), direction="IN", kind="REVENUE", amount=amt,
                       counterparty="Эквайринг Альфа-Банк",
                       purpose=f"Зачисление по эквайрингу за {(d - timedelta(days=1)).strftime('%d.%m.%Y')}"))
        bal += amt
        if other_share > 0 and d.weekday() == 2:
            own = round(rev * other_share * season[m - 1] * 7 / 30.4 * 0.6, -2)
            tx.append(dict(date=d.isoformat(), direction="IN", kind="OWN_TRANSFER", amount=own,
                           counterparty=owner_name,
                           purpose="Перевод собственных средств с р/с в АО «Банк Пример» (синтетический)"))
            bal += own
        for kind, cp, day, base in recurring:
            if d.day == min(day, _month_days(y, m)):
                out = round(base * rnd.uniform(0.97, 1.03), -2)
                tx.append(dict(date=d.isoformat(), direction="OUT", kind=kind, amount=out, counterparty=cp,
                               purpose=f"{'Арендная плата' if kind == 'RENT' else 'Заработная плата'} за {m:02d}.{y}"))
                bal -= out
        for c in alfa_credits:
            if d.day == c["payment_day"] and d > date.fromisoformat(c["opened"]):
                tx.append(dict(date=d.isoformat(), direction="OUT", kind="LOAN_PAYMENT", amount=c["monthly_payment"],
                               counterparty="АО «Альфа-Банк»", purpose="Погашение по кредитному договору"))
                bal -= c["monthly_payment"]
        for e in external:
            if d.day == 20 and e["overdue_days"] == 0:
                tx.append(dict(date=d.isoformat(), direction="OUT", kind="LOAN_PAYMENT", amount=e["monthly_payment"],
                               counterparty=e["bank"], purpose="Платёж по кредитному договору"))
                bal -= e["monthly_payment"]
        if d.weekday() < 5 and rnd.random() < 0.6:
            out = round(target * 0.3 / 13 * rnd.uniform(0.6, 1.4), -2)
            tx.append(dict(date=d.isoformat(), direction="OUT", kind="SUPPLIER", amount=out,
                           counterparty=f"ООО «Поставщик-{rnd.randint(1, 15)}»", purpose="Оплата за товар по счёту"))
            bal -= out
        if d.day == 28 and m in (1, 4, 7, 10):
            out = round(rev * 3 * 0.06 * 0.7, -2)
            tx.append(dict(date=d.isoformat(), direction="OUT", kind="TAX", amount=out,
                           counterparty="Казначейство России (ФНС)", purpose="Единый налоговый платёж"))
            bal -= out
        if d.day == _month_days(y, m) and bal > rev * 0.3:
            out = round(bal - rev * 0.3, -3)
            tx.append(dict(date=d.isoformat(), direction="OUT", kind="OWNER_WITHDRAWAL", amount=out,
                           counterparty=owner_name,
                           purpose="Перевод собственных средств на личный счёт" if ip else "Выплата дивидендов"))
            bal -= out
        if bal < 50_000:
            top = round(150_000 - bal, -3)
            tx.append(dict(date=d.isoformat(), direction="IN", kind="OWN_TRANSFER", amount=top,
                           counterparty=owner_name, purpose="Пополнение счёта собственными средствами"))
            bal += top
        d += timedelta(days=1)

    inn = _inn(sid, ip)
    name = f"ИП {owner_name}" if ip else f"ООО «Песочница-{sid[-4:].upper()}»"
    fns_2025 = round(sum(rev * season[i] for i in range(12)), -3) if reg < date(2025, 1, 1) else None
    assets = ([dict(kind=p.asset_kind, title=f"{ASSET_TITLES[p.asset_kind]} (песочница)", value=p.real_estate_value)]
              if p.real_estate_value else [])
    title = f"Песочница: {'ИП' if ip else 'ООО'}, {industry_title}, {rev // 1000} тыс. ₽/мес"
    return dict(
        persona=dict(
            id=sid, segment=segment_for(p), login=sid, password="demo", title=title, expected=None,
            demo_note="Создан проверяющим в песочнице", sandbox=True,
            scenario=dict(purpose="inventory", frequency="once", urgency="month", amount=rev, term_months=12,
                          priority="small_payment", repayment="equal", assets=["real_estate"] if assets else ["none"]),
            alt_scenarios=[], employees=[], assets_owned=assets,
        ),
        alfa=dict(
            person=dict(full_name=owner_name, birth="1985-01-01", phone="+79000000000",
                        passport="0000 000000 (синтетический)", reg_address="синтетический адрес", reg_type="PERMANENT"),
            account=dict(number=("40802810" if ip else "40702810") + inn.ljust(12, "0")[:12],
                         opened=opened.isoformat(), balance_as_of=HISTORY_END.isoformat(), balance=round(bal, 2)),
            credits=alfa_credits, transactions=tx,
        ),
        registry=dict(
            inn=inn, ogrn=_ogrn(sid, ip), type=p.type, name=name, status="ACTIVE", reg_date=reg.isoformat(),
            okved=okved, region="Москва", bankruptcy=False, director=dict(full_name=owner_name),
            owners=[dict(full_name=owner_name, share=1.0)],
            legal_address=None if ip else "Москва, ул. Синтетическая, д. 1",
            address_invalid=False, mass_address=False,
        ),
        fns=dict(regime="USN6", tax_debt=p.tax_debt, account_block=False,
                 annual_revenue={"2025": fns_2025} if fns_2025 else {}),
        bki=bki,
    )
