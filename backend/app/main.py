"""API entry point; business endpoints are added as their persistence is ready."""

from fastapi import FastAPI

app = FastAPI(title="Умный кредитный кабинет", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "alive"}
