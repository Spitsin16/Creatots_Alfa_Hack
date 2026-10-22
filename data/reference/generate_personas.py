"""Генератор синтетических тестовых персон для моков.

Запуск:  python generate_personas.py ../personas
Детерминированный (фиксированный seed): при повторном запуске данные те же.
Все данные синтетические, совпадения с реальными людьми и компаниями случайны.
"""
import json
import math
import random
import sys
from datetime import date, timedelta
from pathlib import Path

AS_OF = date(2026, 10, 22)          # «сегодня» в демо
HISTORY_START = date(2025, 10, 1)   # 12 полных месяцев: 2025-10 … 2026-09
HISTORY_END = AS_OF - timedelta(days=1)


# ---------------------------------------------------------------- ИНН/ОГРН
def inn10(seed):
    rnd = random.Random(seed)
    d = [rnd.randint(0, 9) for _ in range(9)]
    w = [2, 4, 10, 3, 5, 9, 4, 6, 8]
    c = sum(a * b for a, b in zip(d, w)) % 11 % 10
    return "".join(map(str, d + [c]))


def inn12(seed):
    rnd = random.Random(seed)
    d = [rnd.randint(0, 9) for _ in range(10)]
    w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
    c1 = sum(a * b for a, b in zip(d, w1)) % 11 % 10
    d.append(c1)
    w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
    c2 = sum(a * b for a, b in zip(d, w2)) % 11 % 10
    return "".join(map(str, d + [c2]))


def ogrn(seed, ip):
    rnd = random.Random(seed)
    if ip:  # ОГРНИП 15 знаков
        body = "3" + "".join(str(rnd.randint(0, 9)) for _ in range(13))
        return body + str(int(body) % 13 % 10)
    body = "1" + "".join(str(rnd.randint(0, 9)) for _ in range(11))
    return body + str(int(body) % 11 % 10)


# ---------------------------------------------------------------- персоны
# season — множитель выручки по месяцам 1..12
FLAT = [1.0] * 12
COFFEE = [1.05, 0.9, 1.0, 1.0, 1.05, 0.95, 0.9, 0.9, 1.05, 1.1, 1.05, 1.15]
BAKERY = [0.95, 0.95, 1.0, 1.0, 1.0, 0.95, 0.95, 0.95, 1.05, 1.05, 1.05, 1.15]
BUILD = [0.45, 0.5, 0.85, 1.1, 1.25, 1.3, 1.3, 1.25, 1.15, 1.0, 0.85, 0.7]

PERSONAS = [
    dict(
        id="p1a", segment="1А", login="p1a", password="demo",
        title="ИП, пекарня, кредит только в Альфе",
        type="IP", name="ИП Морозова Анна Сергеевна", brand="Пекарня «Хлебный двор»",
        person=dict(full_name="Морозова Анна Сергеевна", birth="1987-04-12"),
        reg_date="2022-03-15", okved="10.71", region="Москва",
        revenue=1_800_000, cv=0.06, season=BAKERY, buyers=False,
        acquiring_other_bank_share=0.0, account_opened="2022-03-20",
        recurring=[
            ("RENT", "ИП Соколов В.А. (аренда)", 5, 220_000),
            ("SALARY", "Зарплата сотрудникам", 10, 260_000),
            ("SALARY", "Зарплата сотрудникам", 25, 260_000),
            ("SUPPLIER", "ООО «Мельница-Центр»", 12, 380_000),
        ],
        supplier_share=0.28,
        alfa_credits=[dict(product="WORKING_CAPITAL", status="ACTIVE", amount=2_400_000,
                           opened="2025-04-10", balance=1_210_000, monthly_payment=120_000,
                           rate=21.5, payment_day=10, max_overdue_days=0)],
        fns=dict(regime="USN6", tax_debt=0, account_block=False),
        bki=dict(has_history=True, current_overdue_days=0, past_max_overdue_days_12m=0, external=[]),
        start_balance=900_000,
        scenario=dict(purpose="inventory", frequency="once", urgency="month", amount=2_000_000,
                      term_months=12, priority="small_payment", repayment="equal", assets=["none"]),
        expected="APPROVED",
        demo_note="Одобрено сразу, прогноз разрыва показывает просадку 12 ноября (закупка муки + зарплата).",
    ),
    dict(
        id="p1b", segment="1Б", login="p1b", password="demo",
        title="ООО, оптовая торговля, кредиты в Альфе и в другом банке",
        type="LLC", name="ООО «Оптторг-Регион»", brand="Оптторг-Регион",
        person=dict(full_name="Белов Игорь Петрович", birth="1979-09-02"),
        reg_date="2020-06-01", okved="46.39", region="Москва",
        revenue=6_000_000, cv=0.12, season=FLAT, buyers=True,
        acquiring_other_bank_share=0.0, account_opened="2020-06-05",
        recurring=[
            ("RENT", "ООО «Склад-Сервис» (аренда склада)", 3, 450_000),
            ("SALARY", "Зарплата сотрудникам", 10, 700_000),
            ("SALARY", "Зарплата сотрудникам", 25, 700_000),
        ],
        supplier_share=0.30,
        alfa_credits=[dict(product="CREDIT_LINE", status="ACTIVE", amount=15_000_000,
                           opened="2024-11-01", balance=9_800_000, monthly_payment=1_200_000,
                           rate=20.0, payment_day=15, max_overdue_days=0)],
        fns=dict(regime="OSNO", tax_debt=0, account_block=False),
        bki=dict(has_history=True, current_overdue_days=0, past_max_overdue_days_12m=0,
                 external=[dict(bank="Банк «Северный»", product="Кредит на развитие", balance=9_000_000,
                                monthly_payment=840_000, rate=24.0, months_left=13, overdue_days=0)]),
        start_balance=2_500_000,
        scenario=dict(purpose="inventory", frequency="once", urgency="month", amount=4_000_000,
                      term_months=24, priority="max_amount", repayment="equal", assets=["real_estate"],
                      asset_value=0),
        expected="COUNTER_OFFER",
        demo_note="Новых денег сейчас нет: платежи уже 34% выручки. Контрпредложение — перенести кредит «Северного» к нам, платёж ниже, после этого лимит на новые цели.",
    ),
    dict(
        id="p2a", segment="2А", login="p2a", password="demo",
        title="ИП, автосервис, бывший заёмщик Альфы, кредит в другом банке",
        type="IP", name="ИП Гаврилов Максим Олегович", brand="Автосервис «Гараж 24»",
        person=dict(full_name="Гаврилов Максим Олегович", birth="1985-01-23"),
        reg_date="2019-08-12", okved="45.20", region="Москва",
        revenue=1_100_000, cv=0.22, season=FLAT, buyers=False,
        acquiring_other_bank_share=0.0, account_opened="2019-09-01",
        recurring=[
            ("RENT", "ООО «Промзона» (аренда бокса)", 7, 150_000),
            ("SALARY", "Зарплата мастерам", 15, 280_000),
        ],
        supplier_share=0.25,
        alfa_credits=[dict(product="WORKING_CAPITAL", status="CLOSED", amount=1_500_000,
                           opened="2022-05-10", closed="2024-05-10", balance=0, monthly_payment=0,
                           rate=17.0, payment_day=10, max_overdue_days=0)],
        fns=dict(regime="USN6", tax_debt=0, account_block=False),
        bki=dict(has_history=True, current_overdue_days=0, past_max_overdue_days_12m=0,
                 external=[dict(bank="Банк «Восток-Кредит»", product="Кредит для ИП", balance=1_400_000,
                                monthly_payment=72_000, rate=26.0, months_left=24, overdue_days=0)]),
        start_balance=350_000,
        scenario=dict(purpose="refinance", frequency="once", urgency="month", amount=1_400_000,
                      term_months=36, priority="small_payment", repayment="equal", assets=["vehicle"]),
        expected="APPROVED",
        demo_note="«С возвращением»: рефинансирование одобрено, платёж ниже, история погашений в Альфе в плюс.",
    ),
    dict(
        id="p2b", segment="2Б", login="p2b", password="demo",
        title="ИП, салон красоты, бывший заёмщик с просрочкой в прошлом",
        type="IP", name="ИП Лебедева Ольга Викторовна", brand="Салон «Лайм»",
        person=dict(full_name="Лебедева Ольга Викторовна", birth="1990-11-30"),
        reg_date="2021-02-18", okved="96.02", region="Москва",
        revenue=700_000, cv=0.34, season=COFFEE, buyers=False,
        acquiring_other_bank_share=0.0, account_opened="2021-03-01",
        recurring=[
            ("RENT", "ИП Карпов Д.Н. (аренда)", 1, 120_000),
            ("SALARY", "Выплаты мастерам", 20, 210_000),
        ],
        supplier_share=0.15,
        alfa_credits=[dict(product="WORKING_CAPITAL", status="CLOSED", amount=800_000,
                           opened="2023-03-01", closed="2025-03-01", balance=0, monthly_payment=0,
                           rate=19.0, payment_day=1, max_overdue_days=45)],
        fns=dict(regime="USN6", tax_debt=0, account_block=False),
        bki=dict(has_history=True, current_overdue_days=0, past_max_overdue_days_12m=35, external=[]),
        start_balance=150_000,
        scenario=dict(purpose="equipment", frequency="once", urgency="planned", amount=1_500_000,
                      term_months=24, priority="small_payment", repayment="equal", assets=["none"]),
        expected="MANUAL_REVIEW",
        demo_note="Класс D: просрочка 45 дней по прошлому кредиту в Альфе и 35 дней по карте в другом банке весной 2026. Ручная проверка, андеррайтер решает.",
    ),
    dict(
        id="p3a", segment="3А", login="p3a", password="demo",
        title="ООО, стройматериалы, клиент Альфы с кредитом в другом банке; заявку готовит бухгалтер по МЧД",
        type="LLC", name="ООО «СтройБаза»", brand="СтройБаза",
        person=dict(full_name="Орлов Сергей Николаевич", birth="1976-05-14"),
        reg_date="2017-04-03", okved="47.52", region="Московская область",
        revenue=4_200_000, cv=0.12, season=BUILD, buyers=True,
        acquiring_other_bank_share=0.0, account_opened="2017-04-10",
        recurring=[
            ("RENT", "ООО «Логистик-Парк» (аренда)", 4, 300_000),
            ("SALARY", "Зарплата сотрудникам", 10, 520_000),
            ("SALARY", "Зарплата сотрудникам", 25, 520_000),
        ],
        supplier_share=0.38,
        alfa_credits=[],
        fns=dict(regime="USN15", tax_debt=0, account_block=False),
        bki=dict(has_history=True, current_overdue_days=0, past_max_overdue_days_12m=0,
                 external=[dict(bank="Банк «Приволжский»", product="Кредит на развитие", balance=5_500_000,
                                monthly_payment=260_000, rate=23.0, months_left=28, overdue_days=0)]),
        employees=[dict(login="p3a_acc", password="demo", full_name="Зайцева Марина Ильинична",
                        role="Бухгалтер", mchd=dict(number="МЧД-2026-000731", valid_to="2027-06-30",
                                                     permissions=["VIEW", "FILL", "CONSENT"]))],
        assets_owned=[dict(kind="real_estate", title="Склад 1 200 м², Подольск", value=24_000_000)],
        start_balance=1_800_000,
        scenario=dict(purpose="refinance", frequency="once", urgency="month", amount=5_500_000,
                      term_months=48, priority="small_payment", repayment="seasonal", assets=["real_estate"]),
        expected="MANUAL_REVIEW",
        demo_note="Бухгалтер готовит заявку → «ждёт подписи руководителя» → директор отправляет. Сумма > 5 млн → андеррайтер + риск-менеджер. Сезонная выручка → сезонный график. Есть склад → совет про залог.",
    ),
    dict(
        id="p3b", segment="3Б", login="p3b", password="demo",
        title="ИП, кофейня 8 месяцев, клиент Альфы без кредитов — главный демо-сценарий",
        type="IP", name="ИП Иванов Артём Дмитриевич", brand="Кофейня «Зерно»",
        person=dict(full_name="Иванов Артём Дмитриевич", birth="1995-07-08"),
        reg_date="2026-02-02", okved="56.10", region="Москва",
        revenue=1_200_000, cv=0.25, season=COFFEE, buyers=False,
        acquiring_other_bank_share=0.25, account_opened="2026-02-05",
        recurring=[
            ("RENT", "ООО «Арбат-Недвижимость» (аренда)", 12, 300_000),
            ("SALARY", "Зарплата бариста", 10, 160_000),
            ("SALARY", "Зарплата бариста", 25, 160_000),
            ("SUPPLIER", "ООО «Зерновой дом» (закупка зерна)", 12, 520_000),
        ],
        supplier_share=0.25,
        alfa_credits=[],
        fns=dict(regime="USN6", tax_debt=0, account_block=False),
        bki=dict(has_history=False, current_overdue_days=0, past_max_overdue_days_12m=0, external=[]),
        start_balance=250_000, cushion=0.1,
        scenario=dict(purpose="cash_gap", frequency="always", urgency="days", amount=240_000,
                      term_months=12, priority="small_payment", repayment="equal", assets=["none"]),
        expected="APPROVED",
        demo_note="Прогноз: 12 ноября не хватит ~211 тыс. (аренда + зерно в один день) → кнопка «Закрыть из овердрафта» на 240 тыс. → одобрено (лимит 270 тыс.). Вариант: клиент просит 340 тыс. → контрпредложение 270 тыс. → «Как получить больше»: загрузить выписку из другого банка (там 25% выручки через эквайринг) → лимит 360 тыс. → одобрено.",
        alt_scenarios=[dict(amount=340_000, expected="COUNTER_OFFER", counter_amount=270_000),
                       dict(amount=340_000, upload_statement="statements/p3b_other_bank_1c.txt", expected="APPROVED", limit=360_000)],
    ),
    dict(
        id="p_stop", segment="3Б", login="p_stop", password="demo",
        title="ИП, грузоперевозки, текущая просрочка 30+ в другом банке — стоп-фактор",
        type="IP", name="ИП Ковалёв Денис Андреевич", brand="Перевозки «Ковалёв»",
        person=dict(full_name="Ковалёв Денис Андреевич", birth="1983-03-19"),
        reg_date="2018-10-01", okved="49.41", region="Москва",
        revenue=900_000, cv=0.28, season=FLAT, buyers=True,
        acquiring_other_bank_share=0.0, account_opened="2023-01-15",
        recurring=[
            ("OTHER", "ООО «ТопливоСнаб» (топливо)", 5, 210_000),
            ("SALARY", "Выплаты водителям", 15, 240_000),
        ],
        supplier_share=0.2,
        alfa_credits=[],
        fns=dict(regime="USN6", tax_debt=48_000, account_block=False),
        bki=dict(has_history=True, current_overdue_days=37, past_max_overdue_days_12m=37,
                 external=[dict(bank="Банк «Магистраль»", product="Лизинг тягача", balance=2_100_000,
                                monthly_payment=115_000, rate=27.0, months_left=20, overdue_days=37)]),
        start_balance=120_000,
        scenario=dict(purpose="other", frequency="once", urgency="days", amount=800_000,
                      term_months=12, priority="max_amount", repayment="equal", assets=["vehicle"]),
        expected="REJECTED",
        demo_note="Стоп-фактор CURRENT_OVERDUE: отказ сразу на предрасчёте с объяснением и планом «погасите просрочку — возвращайтесь».",
    ),
]

BANK_USERS = [
    dict(login="uw1", password="demo", role="UNDERWRITER", full_name="Андеррайтер Смирнова Е."),
    dict(login="uw2", password="demo", role="UNDERWRITER", full_name="Андеррайтер Петров К."),
    dict(login="risk1", password="demo", role="RISK_MANAGER", full_name="Риск-менеджер Волков А."),
    dict(login="admin1", password="demo", role="RULES_ADMIN", full_name="Админ правил Ким Д."),
]

INFLOW_TEXT = {
    "acq": "Зачисление по эквайрингу за {d}",
    "buyer": "Оплата по счёту № {n} от покупателя",
    "own": "Перевод собственных средств с р/с в {bank}",
    "refund": "Возврат ошибочно перечисленных средств",
}


def month_days(y, m):
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - date(y, m, 1)).days


def ip_like(p):
    return p["type"] == "IP"


def gen_transactions(p):
    rnd = random.Random(p["id"])
    tx = []
    opened = date.fromisoformat(p["account_opened"])
    start = max(HISTORY_START, opened)
    bal = p["start_balance"]
    # месячный шум выручки под нужный коэффициент вариации
    month_noise = {}
    d = start
    while d <= HISTORY_END:
        key = (d.year, d.month)
        if key not in month_noise:
            month_noise[key] = max(0.35, rnd.gauss(1.0, p["cv"]))
        d += timedelta(days=1)
    other_bank = "АО «Банк Пример» (синтетический)" if p["acquiring_other_bank_share"] else None
    n_doc = 1000
    d = start
    while d <= HISTORY_END:
        y, m = d.year, d.month
        target = p["revenue"] * p["season"][m - 1] * month_noise[(y, m)]
        alfa_share = 1 - p["acquiring_other_bank_share"]
        daily = target * alfa_share / month_days(y, m)
        wk = 0.8 if d.weekday() == 0 else (1.15 if d.weekday() >= 4 else 1.0)
        amount = daily * wk * rnd.uniform(0.85, 1.15)
        if p["buyers"]:
            if d.weekday() < 5 and rnd.random() < 0.75:
                n_doc += 1
                amt = round(amount / 0.75 * (7 / 5), -2)
                tx.append(dict(date=d.isoformat(), direction="IN", kind="REVENUE", amount=amt,
                               counterparty=f"ООО «Покупатель-{rnd.randint(1, 40)}»",
                               purpose=INFLOW_TEXT["buyer"].format(n=n_doc)))
                bal += amt
        else:
            amt = round(amount, -2)
            tx.append(dict(date=d.isoformat(), direction="IN", kind="REVENUE", amount=amt,
                           counterparty="Эквайринг Альфа-Банк",
                           purpose=INFLOW_TEXT["acq"].format(d=(d - timedelta(days=1)).strftime("%d.%m.%Y"))))
            bal += amt
        # свои переводы из другого банка (эквайринг там) — раз в неделю
        if other_bank and d.weekday() == 2:
            own = round(p["revenue"] * p["acquiring_other_bank_share"] * p["season"][m - 1] * 7 / 30.4 * 0.6, -2)
            tx.append(dict(date=d.isoformat(), direction="IN", kind="OWN_TRANSFER", amount=own,
                           counterparty=p["name"], purpose=INFLOW_TEXT["own"].format(bank=other_bank)))
            bal += own
        # регулярные платежи
        for kind, cp, day, base in p["recurring"]:
            if d.day == min(day, month_days(y, m)):
                amt = round(base * rnd.uniform(0.97, 1.03), -2)
                tx.append(dict(date=d.isoformat(), direction="OUT", kind=kind, amount=amt, counterparty=cp,
                               purpose={"RENT": "Арендная плата за {m:02d}.{y}",
                                        "SALARY": "Заработная плата за {m:02d}.{y}",
                                        "SUPPLIER": "Оплата по договору поставки, {m:02d}.{y}",
                                        "OTHER": "Оплата по договору, {m:02d}.{y}"}[kind].format(m=m, y=y)))
                bal -= amt
        # платежи по кредитам Альфы
        for c in p["alfa_credits"]:
            opened_c = date.fromisoformat(c["opened"])
            closed_c = date.fromisoformat(c["closed"]) if c.get("closed") else None
            if c["monthly_payment"] and d.day == c["payment_day"] and d > opened_c and (not closed_c or d <= closed_c):
                tx.append(dict(date=d.isoformat(), direction="OUT", kind="LOAN_PAYMENT", amount=c["monthly_payment"],
                               counterparty="АО «Альфа-Банк»", purpose="Погашение по кредитному договору"))
                bal -= c["monthly_payment"]
        # платежи по внешним кредитам (видны как исходящие в другой банк)
        for e in p["bki"]["external"]:
            if d.day == 20 and e["overdue_days"] == 0:
                tx.append(dict(date=d.isoformat(), direction="OUT", kind="LOAN_PAYMENT", amount=e["monthly_payment"],
                               counterparty=e["bank"], purpose="Платёж по кредитному договору"))
                bal -= e["monthly_payment"]
        # поставщики — по рабочим дням, доля выручки
        if d.weekday() < 5 and rnd.random() < 0.6:
            amt = round(target * p["supplier_share"] / 13 * rnd.uniform(0.6, 1.4), -2)
            tx.append(dict(date=d.isoformat(), direction="OUT", kind="SUPPLIER", amount=amt,
                           counterparty=f"ООО «Поставщик-{rnd.randint(1, 15)}»",
                           purpose="Оплата за товар по счёту"))
            bal -= amt
        # налог УСН: аванс 28 числа после квартала
        if d.day == 28 and m in (1, 4, 7, 10) and p["fns"]["regime"].startswith("USN"):
            rate = 0.06 if p["fns"]["regime"] == "USN6" else 0.03
            amt = round(p["revenue"] * 3 * rate * 0.7, -2)
            tx.append(dict(date=d.isoformat(), direction="OUT", kind="TAX", amount=amt,
                           counterparty="Казначейство России (ФНС)", purpose="Единый налоговый платёж"))
            bal -= amt
        # прочие мелкие расходы
        if rnd.random() < 0.3:
            amt = round(p["revenue"] * 0.004 * rnd.uniform(0.5, 1.5), -2)
            tx.append(dict(date=d.isoformat(), direction="OUT", kind="OTHER", amount=amt,
                           counterparty="Разные получатели", purpose="Хозяйственные расходы"))
            bal -= amt
        # владелец забирает прибыль в последний день месяца, оставляя подушку
        if d.day == month_days(y, m):
            cushion = p["revenue"] * p.get("cushion", 0.3)
            if bal > cushion:
                out_amt = round(bal - cushion, -3)
                tx.append(dict(date=d.isoformat(), direction="OUT", kind="OWNER_WITHDRAWAL", amount=out_amt,
                               counterparty=p["person"]["full_name"],
                               purpose="Перевод собственных средств на личный счёт" if ip_like(p) else "Выплата дивидендов"))
                bal -= out_amt
        # подстраховка: бизнес не уходит в минус в истории — владелец довносит
        if bal < 50_000:
            top = round(150_000 - bal, -3)
            tx.append(dict(date=d.isoformat(), direction="IN", kind="OWN_TRANSFER", amount=top,
                           counterparty=p["person"]["full_name"], purpose="Пополнение счёта собственными средствами"))
            bal += top
        d += timedelta(days=1)
    return tx, round(bal, 2)


def build(p):
    tx, balance = gen_transactions(p)
    ip = p["type"] == "IP"
    inn = inn12(p["id"]) if ip else inn10(p["id"])
    reg = date.fromisoformat(p["reg_date"])
    # годовая выручка 2025 по ФНС: считаем по профилю, включая долю через другой банк
    fns_2025 = None
    if reg < date(2025, 1, 1):
        fns_2025 = round(sum(p["revenue"] * p["season"][m] for m in range(12)), -3)
    registry = dict(
        inn=inn, ogrn=ogrn(p["id"], ip), type=p["type"], name=p["name"], status="ACTIVE",
        reg_date=p["reg_date"], okved=p["okved"], region=p["region"], bankruptcy=False,
        director=dict(full_name=p["person"]["full_name"]),
        owners=[dict(full_name=p["person"]["full_name"], share=1.0)],
        legal_address=None if ip else f"{p['region']}, ул. Синтетическая, д. {random.Random(p['id']).randint(1, 99)}",
        address_invalid=False, mass_address=False,
    )
    alfa = dict(
        person=dict(full_name=p["person"]["full_name"], birth=p["person"]["birth"], phone=f"+7900000{p['id'][-2:].replace('_', '0'):0>4}"[:12],
                    passport="4500 000000 (синтетический)", reg_address=f"{p['region']}, синтетический адрес",
                    reg_type="PERMANENT"),
        account=dict(number="40802810" + inn[:12].ljust(12, "0") if ip else "40702810" + inn.ljust(12, "0"),
                     opened=p["account_opened"], balance_as_of=HISTORY_END.isoformat(), balance=balance),
        credits=p["alfa_credits"],
        transactions=tx,
    )
    fns = dict(p["fns"], annual_revenue={"2025": fns_2025} if fns_2025 else {})
    persona = {k: p[k] for k in ("id", "segment", "login", "password", "title", "expected", "demo_note", "scenario")}
    persona["alt_scenarios"] = p.get("alt_scenarios", [])
    persona["employees"] = p.get("employees", [])
    persona["assets_owned"] = p.get("assets_owned", [])
    return dict(persona=persona, alfa=alfa, registry=registry, fns=fns, bki=p["bki"])


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for p in PERSONAS:
        data = build(p)
        (out / f"{p['id']}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(p["id"], len(data["alfa"]["transactions"]), "tx, balance", data["alfa"]["account"]["balance"])
    (out / "bank_users.json").write_text(json.dumps(BANK_USERS, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "personas")
