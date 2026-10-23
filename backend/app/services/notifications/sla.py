"""Срок ответа в чате: 4 рабочих часа, рабочее время 9:00–18:00 по Москве, пн–пт.

Чистая функция; праздники в демо не учитываем (допущение в ASSUMPTIONS).
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta, timezone

MSK = timezone(timedelta(hours=3), "MSK")
DAY_START = time(9, 0)
DAY_END = time(18, 0)
ANSWER_HOURS = 4


def _next_work_start(local: datetime) -> datetime:
    d = local
    if d.time() >= DAY_END:
        d = (d + timedelta(days=1)).replace(hour=DAY_START.hour, minute=0, second=0, microsecond=0)
    elif d.time() < DAY_START:
        d = d.replace(hour=DAY_START.hour, minute=0, second=0, microsecond=0)
    while d.weekday() >= 5:
        d = (d + timedelta(days=1)).replace(hour=DAY_START.hour, minute=0, second=0, microsecond=0)
    return d


def answer_due(now: datetime, hours: float = ANSWER_HOURS) -> datetime:
    """Момент, к которому сотрудник должен ответить (в UTC)."""
    local = _next_work_start(now.astimezone(MSK))
    left = timedelta(hours=hours)
    while True:
        end_of_day = local.replace(hour=DAY_END.hour, minute=0, second=0, microsecond=0)
        if local + left <= end_of_day:
            return (local + left).astimezone(UTC)
        left -= end_of_day - local
        local = _next_work_start(end_of_day)


def due_text(due: datetime, now: datetime) -> str:
    """«ответим до 18:00» / «ответим завтра до 13:00» / «ответим 26.10 до 13:00»."""
    d, n = due.astimezone(MSK), now.astimezone(MSK)
    hm = d.strftime("%H:%M")
    if d.date() == n.date():
        return f"ответим до {hm}"
    if d.date() == n.date() + timedelta(days=1):
        return f"ответим завтра до {hm}"
    return f"ответим {d.strftime('%d.%m')} до {hm}"
