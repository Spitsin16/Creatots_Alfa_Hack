"""Stable public error envelope for the HTTP API."""

from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class APIError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def _content(request: Request, code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "details": details,
        "request_id": request.state.request_id,
    }


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=jsonable_encoder(_content(request, exc.code, exc.message, exc.details)),
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(_content(request, "VALIDATION_ERROR", "Проверьте заполненные поля", exc.errors())),
    )
