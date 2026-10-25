"""Подписанный договор как аккуратная HTML-страница (правка ментора 25.10 вместо .txt).

Чистая функция: на вход условия и график, на выход HTML. Файл самодостаточный:
стили внутри, внешних ресурсов нет; открывается в браузере, печатается и
сохраняется в PDF кнопкой «Сохранить в PDF». Везде пометка «ДЕМО»: данные
синтетические, юридической силы документ не имеет.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from html import escape

MSK = timezone(timedelta(hours=3))

PRODUCT_TITLE = {
    "OVERDRAFT": "Овердрафт",
    "WORKING_CAPITAL": "Кредит на пополнение оборотных средств",
    "CREDIT_LINE": "Кредитная линия",
    "REFINANCE": "Рефинансирование кредитов других банков",
}
PURPOSE_TITLE = {
    "cash_gap": "покрытие кассовых разрывов",
    "inventory": "закупка товара и сырья",
    "equipment": "покупка оборудования",
    "expansion": "развитие бизнеса",
    "refinance": "рефинансирование действующих кредитов",
    "other": "текущая деятельность",
}
BUSINESS_TYPE = {"IP": "Индивидуальный предприниматель", "LLC": "Общество с ограниченной ответственностью"}
MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября",
              "ноября", "декабря"]


def rub(value: float | int) -> str:
    return f"{round(value):,}".replace(",", " ") + " ₽"


def long_date(d: date) -> str:
    return f"«{d.day}» {MONTHS_GEN[d.month - 1]} {d.year} г."


def short_date(iso: str) -> str:
    d = date.fromisoformat(iso[:10])
    return f"{d.day:02d}.{d.month:02d}.{d.year}"


def contract_number(application_id: str, signed: datetime) -> str:
    return f"ДЕМО-{signed:%y%m}-{application_id[:6].upper()}"


def _schedule_table(rows: list[dict], principal: float) -> str:
    body = "".join(
        f"<tr><td>{i}</td><td>{short_date(r['date'])}</td><td class=num><b>{rub(r['payment'])}</b></td>"
        f"<td class=num>{rub(r['principal'])}</td><td class=num>{rub(r['interest'])}</td>"
        f"<td class=num>{rub(r['balance'])}</td></tr>"
        for i, r in enumerate(rows, 1)
    )
    total = sum(r["payment"] for r in rows)
    interest = total - round(principal)  # итог по процентам = переплата, без копеечных хвостов округления
    return (
        "<table class=schedule><thead><tr><th>№</th><th>Дата</th><th class=num>Платёж</th>"
        "<th class=num>Основной долг</th><th class=num>Проценты</th><th class=num>Остаток</th></tr></thead>"
        f"<tbody>{body}</tbody><tfoot><tr><td colspan=2>Итого</td><td class=num><b>{rub(total)}</b></td>"
        f"<td class=num>{rub(principal)}</td><td class=num>{rub(interest)}</td><td></td></tr></tfoot></table>"
    )


def render_contract(*, application_id: str, product: str, purpose: str, amount: float, rate: float,
                    term_months: int, signed_at: datetime, business: dict, signer: str,
                    schedule: dict | None, seasonal: bool) -> str:
    """`business`: name, inn, ogrn, type. `schedule` — формат annuity_schedule / build_seasonal."""
    signed = signed_at.astimezone(MSK)
    number = contract_number(application_id, signed)
    product_title = PRODUCT_TITLE.get(product, product)
    overdraft = product == "OVERDRAFT"
    rows = (schedule or {}).get("schedule") or []
    rate_s = f"{rate:.2f}".replace(".", ",") + "%\u00a0годовых"

    if overdraft:
        key = [("Лимит", rub(amount)), ("Ставка", rate_s),
               ("Срок лимита", f"{term_months} мес."),
               ("Проценты", "только за дни использования")]
        terms = (
            f"<p>Банк открывает Заёмщику лимит овердрафта по расчётному счёту в размере <b>{rub(amount)}</b> "
            f"на срок <b>{term_months} мес.</b> Если на счёте не хватает денег для платежа, Банк оплачивает его "
            "в пределах лимита, а задолженность гасится автоматически первыми поступлениями на счёт.</p>"
            f"<p>Проценты начисляются по ставке <b>{rate_s}</b> только за дни "
            f"фактического использования. Пример: 100&nbsp;000&nbsp;₽ на 10 дней ≈ "
            f"{rub(100_000 * rate / 100 * 10 / 365)}. Графика платежей нет — платёж зависит от использования.</p>"
        )
        table = ""
    else:
        first = rows[0]["payment"] if rows else 0
        key = [("Сумма кредита", rub(amount)), ("Ставка", rate_s),
               ("Срок", f"{term_months} мес."),
               ("Первый платёж", f"{rub(first)}<small>{short_date(rows[0]['date'])}</small>" if rows else "—")]
        kind = ("сезонный: в сезон платёж выше, в слабые месяцы — ниже, по выручке бизнеса" if seasonal
                else "аннуитетный: равные ежемесячные платежи")
        terms = (
            f"<p>Банк предоставляет Заёмщику кредит в размере <b>{rub(amount)}</b> на срок <b>{term_months} мес.</b> "
            f"на цели: {escape(PURPOSE_TITLE.get(purpose, purpose))}. Деньги зачисляются на расчётный счёт "
            "Заёмщика в Банке в день подписания.</p>"
            f"<p>Ставка — <b>{rate_s}</b>, фиксированная на весь срок. "
            f"График погашения — {kind}. Платёж списывается со счёта 1-го числа месяца; если дата выпадает "
            "на выходной, — в ближайший рабочий день.</p>"
            f"<p>Переплата за весь срок — <b>{rub((schedule or {}).get('overpayment', 0))}</b>. "
            "Досрочное погашение — полностью или частично в любой день без комиссии.</p>"
        )
        table = f"<h2>3. График платежей</h2>{_schedule_table(rows, amount)}"

    cards = "".join(f"<div class=card><span>{escape(k)}</span><b>{v}</b></div>" for k, v in key)
    b = business
    return f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Договор {escape(number)} (демо)</title>
<style>
:root{{--ink:#0b1f35;--muted:#5b6b7c;--line:#e3e8ee;--accent:#ef3124;--soft:#f6f8fa}}
*{{box-sizing:border-box}}
body{{margin:0;background:#eef1f4;color:var(--ink);font:15px/1.55 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}}
.page{{position:relative;max-width:820px;margin:32px auto;background:#fff;padding:56px 64px;border-radius:12px;
  box-shadow:0 10px 40px rgba(11,31,53,.08);overflow:hidden}}
.page::before{{content:"ДЕМО";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:180px;font-weight:800;letter-spacing:.1em;color:rgba(239,49,36,.06);transform:rotate(-28deg);pointer-events:none}}
.demo{{display:flex;gap:12px;align-items:flex-start;background:#fff4f3;border:1px solid #ffd6d2;color:#8a1c12;
  padding:12px 16px;border-radius:10px;font-size:13.5px;margin-bottom:32px}}
.demo b{{white-space:nowrap}}
header{{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:20px}}
.brand{{display:flex;align-items:center;gap:10px;font-weight:700}}
.mark{{width:32px;height:32px;border-radius:8px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:800}}
h1{{font-size:26px;line-height:1.2;margin:28px 0 4px}}
.sub{{color:var(--muted);margin:0 0 28px}}
.meta{{text-align:right;color:var(--muted);font-size:13px}}
.meta b{{color:var(--ink);font-size:15px}}
h2{{font-size:17px;margin:32px 0 12px}}
.cards{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:8px 0 8px}}
.card{{background:var(--soft);border-radius:10px;padding:12px 14px}}
.card span{{display:block;color:var(--muted);font-size:12.5px}}
.card b{{font-size:16px}}
.card small{{display:block;color:var(--muted);font-size:12.5px;font-weight:400}}
.parties{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
.party{{border:1px solid var(--line);border-radius:10px;padding:14px 16px;font-size:14px}}
.party small{{color:var(--muted);display:block;margin-bottom:4px}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th{{text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);padding:8px 6px}}
td{{border-bottom:1px solid var(--line);padding:7px 6px}}
tfoot td{{border-bottom:0;border-top:2px solid var(--ink);font-weight:600}}
.num{{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}}
.sign{{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px}}
.stamp{{border:1.5px dashed #2b8a3e;color:#2b8a3e;border-radius:10px;padding:12px 16px;font-size:13.5px}}
.stamp b{{display:block;font-size:15px}}
footer{{margin-top:36px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:12px}}
.print{{position:fixed;right:24px;bottom:24px;background:var(--ink);color:#fff;border:0;border-radius:10px;
  padding:12px 18px;font:600 14px/1 inherit;cursor:pointer;box-shadow:0 6px 20px rgba(11,31,53,.25)}}
@media (max-width:700px){{.page{{margin:0;border-radius:0;padding:28px 18px}}.cards{{grid-template-columns:1fr 1fr}}
  .parties,.sign{{grid-template-columns:1fr}}header{{flex-direction:column}}.meta{{text-align:left}}}}
@media print{{body{{background:#fff}}.page{{margin:0;box-shadow:none;padding:0;max-width:none}}.print{{display:none}}
  .page::before{{position:fixed}}}}
</style></head>
<body><main class="page">
<div class="demo"><b>ДЕМО</b><span>Демонстрационный документ хакатона «Альфа-Будущее». Данные синтетические,
документ не является договором и не имеет юридической силы.</span></div>
<header><div class="brand"><span class="mark">A</span><span>Альфа-Бизнес · кредитный кабинет (демо)</span></div>
<div class="meta">Договор № <b>{escape(number)}</b><br>{long_date(signed.date())}</div></header>
<h1>{escape(product_title)}</h1>
<p class="sub">Кредитный договор · индивидуальные условия</p>
<div class="cards">{cards}</div>

<h2>1. Стороны</h2>
<div class="parties">
<div class="party"><small>Кредитор</small><b>Банк</b><br>демо-стенд «Умный кредитный кабинет»</div>
<div class="party"><small>Заёмщик</small><b>{escape(b.get("name", ""))}</b><br>
{escape(BUSINESS_TYPE.get(b.get("type", ""), ""))}<br>ИНН {escape(b.get("inn", ""))}{" · ОГРН " + escape(b["ogrn"]) if b.get("ogrn") else ""}</div>
</div>

<h2>2. Условия</h2>
{terms}
{table}

<h2>{"3" if overdraft else "4"}. Подписание</h2>
<div class="sign">
<div class="stamp"><b>✓ Подписано электронно</b>{escape(signer)}<br>{signed:%d.%m.%Y в %H:%M} (МСК), код из SMS (демо)</div>
<div class="stamp"><b>✓ Акцептовано Банком</b>Решение по заявке {escape(application_id[:8])}<br>средства зачислены на счёт</div>
</div>
<footer>Заявка {escape(application_id)} · сформировано автоматически при выдаче · ДЕМО, синтетические данные</footer>
</main>
<button class="print" onclick="window.print()">Сохранить в PDF</button>
</body></html>"""
