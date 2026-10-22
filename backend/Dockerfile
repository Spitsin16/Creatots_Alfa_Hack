# Образ API и воркера. Контекст сборки — корень репозитория (нужна папка data/).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app/backend
COPY backend/requirements.lock ./requirements.lock
RUN pip install -r requirements.lock

COPY data /app/data
COPY backend /app/backend

RUN useradd --create-home --uid 1000 app && chown -R app /app
USER app

EXPOSE 8000
# По умолчанию — API; воркер переопределяет команду в docker-compose.yml
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
