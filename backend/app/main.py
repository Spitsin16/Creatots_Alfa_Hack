"""API entry point; business endpoints are added as their persistence is ready."""

from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError

from app.api.assistant import router as assistant_router
from app.api.bank import router as bank_router
from app.api.chat import router as chat_router
from app.api.client_actions import router as client_actions_router
from app.api.documents import router as documents_router
from app.api.errors import APIError, api_error_handler, validation_error_handler
from app.api.insights import router as insights_router
from app.api.routes import router
from app.api.rules_admin import router as rules_router


def create_app(database_url: str | None = None) -> FastAPI:
    application = FastAPI(title="Умный кредитный кабинет", version="0.1.0")
    application.state.database_url = database_url
    application.state.session_factory = None
    application.add_exception_handler(APIError, api_error_handler)
    application.add_exception_handler(RequestValidationError, validation_error_handler)
    application.include_router(router)
    application.include_router(bank_router)
    application.include_router(insights_router)
    application.include_router(chat_router)
    application.include_router(rules_router)
    application.include_router(documents_router)
    application.include_router(client_actions_router)
    application.include_router(assistant_router)

    @application.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = request.headers.get("X-Request-ID") or str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "alive"}

    return application


app = create_app()
