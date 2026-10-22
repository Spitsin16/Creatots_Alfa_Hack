# Умный кредитный кабинет предпринимателя

Разработка MVP для хакатона. Требования и принятые решения: [docs/TZ.md](docs/TZ.md). Текущая передача смены: [docs/PROGRESS.md](docs/PROGRESS.md).

## Что уже запускается

- Детерминированный расчёт предложения из `data/rules.yaml` для семи синтетических персон.
- API-каркас FastAPI с `/health` и Swagger на `/docs`.
- Единый граф разрешённых переходов статусов.
- Схема из 17 таблиц, миграция Alembic и повторяемая загрузка синтетических пользователей, бизнесов, снимков данных и `rules_v1`.
- CI при каждом push и PR: Ruff, pytest, миграция на PostgreSQL 16, сверка расчёта с `expected.json`; сборка фронта включится, когда появится `frontend/package-lock.json`.

Клиентский путь, хранение заявок, роль банка и остальные API ещё в разработке. Статус задач записан в `docs/PROGRESS.md`.

## Запуск локально

Нужен Python 3.12. Из корня проекта:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.lock
cd backend
ruff check .
python -m pytest -q
export DATABASE_URL=sqlite:///./credit-dev.db
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```

После запуска API: `http://127.0.0.1:8000/docs`.

SQLite здесь удобна только для локальной проверки. Основная БД по ТЗ — PostgreSQL 16; адрес для неё показан в `.env.example`.

Все данные в `data/` синтетические. Финансовые правила и ставки являются демонстрационными.
