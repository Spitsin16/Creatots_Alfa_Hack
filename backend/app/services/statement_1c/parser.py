"""Разбор выписки из другого банка в формате 1С (1CClientBankExchange).

Чистые функции без доступа к БД: на вход — байты файла и ИНН клиента,
на выход — документы, помесячная выручка и `extra_statement_revenue`
для `scoring.engine.decide`. Формат: «ключ=значение» построчно,
секции `СекцияРасчСчет … КонецРасчСчет` и `СекцияДокумент=… КонецДокумента`.
Кодировка обычно windows-1251 (`Кодировка=Windows`), бывает UTF-8 (`Кодировка=UTF8`).
"""

from __future__ import annotations

import re
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

MAX_FILE_BYTES = 5 * 1024 * 1024
MIN_FULL_MONTHS = 3
HISTORY_MONTHS = 12

# Поступления, которые не считаются выручкой (по назначению платежа).
NOT_REVENUE_PURPOSE = re.compile(
    r"собственн|кредит|займ|заём|возврат|процент|депозит|субсиди|овердрафт",
    re.IGNORECASE,
)


class StatementError(ValueError):
    """Ошибка разбора. `code` — машинный код, `message` — текст для клиента."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Document:
    number: str
    date: date
    amount_kop: int
    direction: str  # IN | OUT
    counterparty: str
    counterparty_inn: str
    purpose: str
    is_revenue: bool


@dataclass
class Statement:
    account: str
    owner_inn: str | None
    period_start: date
    period_end: date
    opening_balance_kop: int | None
    total_in_kop: int
    total_out_kop: int
    documents: list[Document] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _decode(raw: bytes) -> str:
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8")
    head = raw[:400]
    if b"UTF8" in head.upper() or b"UTF-8" in head.upper():
        return raw.decode("utf-8")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1251")


def _kop(value: str) -> int:
    value = value.strip().replace(" ", "").replace(",", ".")
    if not value:
        return 0
    rub, _, kop = value.partition(".")
    return int(rub) * 100 + int((kop + "00")[:2]) * (1 if not rub.startswith("-") else -1)


def _date(value: str) -> date:
    return datetime.strptime(value.strip(), "%d.%m.%Y").date()


def parse(raw: bytes, client_inn: str | None = None) -> Statement:
    """Разбирает файл. Бросает StatementError с понятным клиенту текстом."""
    if len(raw) > MAX_FILE_BYTES:
        raise StatementError("FILE_TOO_LARGE", "Файл больше 5 МБ — выгрузите выписку за 12 месяцев без вложений")
    text = _decode(raw)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines or lines[0] != "1CClientBankExchange":
        raise StatementError("NOT_1C_FORMAT", "Это не выписка в формате 1С. В клиент-банке выберите «Экспорт в 1С»")

    header: dict[str, str] = {}
    account_section: dict[str, str] = {}
    docs_raw: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    in_account = False
    for line in lines[1:]:
        key, sep, value = line.partition("=")
        if key == "СекцияДокумент":
            current = {"_kind": value}
            continue
        if key == "КонецДокумента":
            if current is not None:
                docs_raw.append(current)
            current = None
            continue
        if key == "СекцияРасчСчет":
            in_account = True
            continue
        if key == "КонецРасчСчет":
            in_account = False
            continue
        if not sep:
            continue
        if current is not None:
            current[key] = value
        elif in_account:
            account_section[key] = value
        else:
            header.setdefault(key, value)

    account = account_section.get("РасчСчет") or header.get("РасчСчет")
    if not account:
        raise StatementError("NO_ACCOUNT", "В файле не указан расчётный счёт — выгрузите выписку заново")
    try:
        start = _date(account_section.get("ДатаНачала") or header["ДатаНачала"])
        end = _date(account_section.get("ДатаКонца") or header["ДатаКонца"])
    except (KeyError, ValueError) as exc:
        raise StatementError("NO_PERIOD", "В файле нет периода выписки") from exc

    st = Statement(
        account=account,
        owner_inn=None,
        period_start=start,
        period_end=end,
        opening_balance_kop=_kop(account_section["НачальныйОстаток"])
        if "НачальныйОстаток" in account_section
        else None,
        total_in_kop=0,
        total_out_kop=0,
    )
    owner_inns: dict[str, int] = defaultdict(int)
    for d in docs_raw:
        incoming = d.get("ПолучательСчет") == account or d.get("ПолучательРасчСчет") == account
        outgoing = d.get("ПлательщикСчет") == account or d.get("ПлательщикРасчСчет") == account
        if incoming == outgoing:
            st.warnings.append(f"Документ №{d.get('Номер', '?')} не относится к счёту {account} — пропущен")
            continue
        if incoming:
            owner_inns[d.get("ПолучательИНН", "")] += 1
            cp, cp_inn = d.get("Плательщик1") or d.get("Плательщик", ""), d.get("ПлательщикИНН", "")
            when = d.get("ДатаПоступило") or d.get("Дата", "")
        else:
            owner_inns[d.get("ПлательщикИНН", "")] += 1
            cp, cp_inn = d.get("Получатель1") or d.get("Получатель", ""), d.get("ПолучательИНН", "")
            when = d.get("ДатаСписано") or d.get("Дата", "")
        try:
            doc_date = _date(when)
            amount = _kop(d.get("Сумма", "0"))
        except ValueError:
            st.warnings.append(f"Документ №{d.get('Номер', '?')}: не читается дата или сумма — пропущен")
            continue
        purpose = d.get("НазначениеПлатежа", "")
        st.documents.append(
            Document(
                number=d.get("Номер", ""),
                date=doc_date,
                amount_kop=amount,
                direction="IN" if incoming else "OUT",
                counterparty=cp,
                counterparty_inn=cp_inn,
                purpose=purpose,
                is_revenue=False,
            )
        )

    if not st.documents:
        raise StatementError("EMPTY", "В выписке нет операций по счёту")
    st.owner_inn = max(owner_inns, key=owner_inns.get) if owner_inns else None
    if client_inn and st.owner_inn and st.owner_inn != client_inn:
        raise StatementError("FOREIGN_INN", "Выписка по счёту другой компании: ИНН в файле не совпадает с вашим")

    for doc in st.documents:
        if doc.direction == "IN":
            st.total_in_kop += doc.amount_kop
            doc.is_revenue = doc.counterparty_inn != st.owner_inn and not NOT_REVENUE_PURPOSE.search(doc.purpose)
        else:
            st.total_out_kop += doc.amount_kop

    declared_in = account_section.get("ВсегоПоступило")
    if declared_in and abs(_kop(declared_in) - st.total_in_kop) > 100:
        st.warnings.append("Сумма поступлений не совпадает с итогом в файле — возможно, выписка выгружена не целиком")
    return st


def _full_months(start: date, end: date) -> list[tuple[int, int]]:
    """Месяцы, целиком покрытые периодом выписки."""
    months = []
    m = date(start.year, start.month, 1)
    while m <= end:
        nxt = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
        if m >= start and nxt - timedelta(days=1) <= end:
            months.append((m.year, m.month))
        m = nxt
    return months


def monthly_revenue(st: Statement, as_of: date) -> dict:
    """Помесячная выручка за последние полные месяцы до `as_of`.

    Неполный первый месяц не берём — как `engine.derive` для счёта в Альфе,
    иначе средняя занижается.
    """
    start = st.period_start
    last_day = min(st.period_end, date(as_of.year, as_of.month, 1) - timedelta(days=1))
    months = [m for m in _full_months(start, last_day)][-HISTORY_MONTHS:]
    rev: dict[tuple[int, int], int] = defaultdict(int)
    for doc in st.documents:
        key = (doc.date.year, doc.date.month)
        if doc.is_revenue and key in months:
            rev[key] += doc.amount_kop
    series = [{"month": f"{y}-{m:02d}", "revenue_kop": rev[(y, m)]} for y, m in months]
    avg_kop = round(statistics.mean(rev[k] for k in months)) if months else 0
    return {
        "months": series,
        "full_months": len(months),
        "avg_revenue_kop": avg_kop,
        "enough": len(months) >= MIN_FULL_MONTHS,
    }


def extra_revenue_for_scoring(raw: bytes, client_inn: str, as_of: date) -> dict:
    """Готовый вход для `decide(..., extra_statement_revenue=…)` (в рублях, как в движке)."""
    st = parse(raw, client_inn)
    mr = monthly_revenue(st, as_of)
    if not mr["enough"]:
        raise StatementError(
            "TOO_SHORT",
            f"В выписке {mr['full_months']} полных мес., нужно минимум {MIN_FULL_MONTHS}. Выгрузите период длиннее",
        )
    return {
        "extra_statement_revenue": mr["avg_revenue_kop"] / 100,
        "monthly": mr["months"],
        "full_months": mr["full_months"],
        "documents": len(st.documents),
        "revenue_documents": sum(1 for d in st.documents if d.is_revenue),
        "bank_account": st.account,
        "period": [st.period_start.isoformat(), st.period_end.isoformat()],
        "warnings": st.warnings,
    }
