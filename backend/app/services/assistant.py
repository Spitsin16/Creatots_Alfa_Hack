"""Ассистент кабинета (ТЗ 16.2): отвечает только про деньги бизнеса клиента и продукты.

Вопрос → намерение (ключевые слова) → наши данные (предложение, факторы, прогноз,
заявка) → ответ по шаблону. Решений не принимает, заявок не подаёт — даёт кнопку на экран.
Чистые функции: данные приходят готовыми.
"""

from __future__ import annotations

import re

from app.services.explain.templates import pct, rub

SUGGESTED = [
    "Почему у меня такой лимит?",
    "Могу ли я взять 500 000 ₽?",
    "Хватит ли денег до конца месяца?",
    "Что с моей заявкой?",
    "Сколько я переплачу?",
]

INTENTS = [
    ("APPLICATION_STATUS", r"заявк|статус|решени[ея]|когда (будут|придут)|одобр"),
    ("CAN_TAKE", r"могу ли|можно ли|взять|дадут|получить \d|\d[\d\s]*(₽|руб|тыс|млн)"),
    ("ENOUGH_MONEY", r"хватит|разрыв|до конца месяца|не хватит|остат"),
    ("OVERPAYMENT", r"перепла|сколько (я )?(отдам|заплачу)|платеж|платёж"),
    ("WHY_LIMIT", r"почему|лимит|такая сумма|мало|больше|увелич"),
]

STATUS_TEXT = {
    "DRAFT": "заявка в черновике — её нужно отправить",
    "AWAITING_SIGNATURE": "заявка подготовлена сотрудником и ждёт отправки руководителем",
    "SUBMITTED": "заявка принята, проверяем данные",
    "VALIDATION": "проверяем данные",
    "ENRICHMENT": "собираем данные из источников",
    "SCORING": "рассчитываем решение",
    "MANUAL_REVIEW": "заявку смотрит специалист, решение — в течение рабочего дня",
    "INFO_REQUESTED": "банк запросил документы — загрузите их в заявке",
    "APPROVED": "кредит одобрен — осталось подписать договор кодом",
    "COUNTER_OFFER": "банк предложил другие условия — примите или откажитесь в заявке",
    "CONTRACT_SIGNED": "договор подписан, деньги вот-вот поступят",
    "ISSUED": "деньги выданы на ваш счёт",
    "REJECTED": "по заявке отказ — причина и что поможет указаны в заявке",
    "CANCELLED": "заявка отменена",
    "EXPIRED": "срок одобрения истёк — рассчитайте предложение заново",
}


def detect(text: str) -> str:
    low = (text or "").lower()
    for intent, pattern in INTENTS:
        if re.search(pattern, low):
            return intent
    return "OUT_OF_SCOPE"


def parse_amount(text: str) -> int | None:
    low = text.lower().replace(" ", " ")
    m = re.search(r"(\d[\d\s]*(?:[.,]\d+)?)\s*(млн|миллион|тыс|к\b)?", low)
    if not m:
        return None
    value = float(m.group(1).replace(" ", "").replace(",", "."))
    unit = m.group(2) or ""
    if unit.startswith("млн") or unit.startswith("миллион"):
        value *= 1_000_000
    elif unit.startswith("тыс") or unit == "к":
        value *= 1_000
    return int(value) if value >= 1000 else None


def answer(text: str, *, explanation: dict | None, offer: dict | None, forecast: dict | None,
           application: dict | None) -> dict:
    """explanation — explain_for_client; offer — {limit, rate, payment, term, product, overpayment};
    forecast — forecast_for_client; application — {status}."""
    intent = detect(text)
    action = None
    if intent == "OUT_OF_SCOPE":
        return {"intent": intent, "action": None,
                "answer": "С этим не помогу. Я отвечаю про деньги вашего бизнеса: лимит и почему он такой, хватит ли "
                          "денег до конца месяца, что с заявкой и сколько вы переплатите."}
    if intent == "APPLICATION_STATUS":
        if not application:
            return {"intent": intent, "action": {"label": "Рассчитать предложение", "target": "offer"},
                    "answer": "Заявок пока нет. Рассчитайте предложение — это займёт пару минут."}
        return {"intent": intent, "action": {"label": "Открыть заявку", "target": "application"},
                "answer": f"Сейчас {STATUS_TEXT.get(application['status'], application['status'])}."}
    if intent == "ENOUGH_MONEY":
        if not forecast:
            return {"intent": intent, "action": None, "answer": "Для прогноза мало данных по счёту."}
        text_ = forecast["headline"] + "."
        if forecast.get("suggestion"):
            text_ += " " + forecast["suggestion"] + "."
            action = {"label": "Рассчитать овердрафт", "target": "offer"}
        return {"intent": intent, "action": action, "answer": text_}
    if not offer or not explanation:
        return {"intent": intent, "action": {"label": "Рассчитать предложение", "target": "offer"},
                "answer": "Сначала рассчитайте предложение — тогда я смогу ответить с вашими цифрами."}
    limit = offer.get("limit") or 0
    if intent == "WHY_LIMIT":
        parts = [explanation.get("why_amount") or explanation.get("reason") or ""]
        if explanation.get("advice"):
            parts.append("Чтобы получить больше: " + explanation["advice"][0]["text"] + ".")
        return {"intent": intent, "action": {"label": "Как получить больше", "target": "offer"},
                "answer": " ".join(p for p in parts if p)}
    if intent == "CAN_TAKE":
        want = parse_amount(text)
        if want is None:
            return {"intent": intent, "action": None, "answer": f"Сейчас доступно до {rub(limit)}. Назовите сумму — проверю."}
        if limit and want <= limit:
            return {"intent": intent, "action": {"label": "Оформить заявку", "target": "offer"},
                    "answer": f"Да: {rub(want)} укладывается в доступные {rub(limit)}."}
        tip = ""
        if explanation.get("advice"):
            best = explanation["advice"][0]
            tip = f" Больше можно получить так: {best['text']}."
        return {"intent": intent, "action": {"label": "Как получить больше", "target": "offer"},
                "answer": f"Сейчас доступно до {rub(limit)}, {rub(want)} — больше лимита.{tip}"}
    # OVERPAYMENT
    if offer.get("product") == "OVERDRAFT":
        return {"intent": intent, "action": None,
                "answer": f"По овердрафту проценты — только за дни, когда вы пользуетесь деньгами: ставка "
                          f"{pct(offer.get('rate'))} годовых. Например, 100 000 ₽ на 10 дней — около "
                          f"{rub(100_000 * (offer.get('rate') or 0) / 100 * 10 / 365)}."}
    if offer.get("payment"):
        return {"intent": intent, "action": None,
                "answer": f"Платёж {rub(offer['payment'])} в месяц на {offer['term']} мес., переплата "
                          f"{rub(offer.get('overpayment') or 0)} при ставке {pct(offer.get('rate'))}."}
    return {"intent": intent, "action": None, "answer": "Для этого предложения переплату не посчитать."}
