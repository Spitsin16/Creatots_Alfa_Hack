"""Small HS256 token helper used by the demo authentication flow."""

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any


class InvalidToken(ValueError):
    """The bearer token is malformed, expired, or has an invalid signature."""


def _encode_part(value: dict[str, Any]) -> str:
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _decode_part(value: str) -> dict[str, Any]:
    try:
        padding = "=" * (-len(value) % 4)
        decoded = base64.urlsafe_b64decode(value + padding)
        payload = json.loads(decoded)
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InvalidToken("invalid token encoding") from exc
    if not isinstance(payload, dict):
        raise InvalidToken("invalid token payload")
    return payload


def _secret() -> bytes:
    return os.getenv("JWT_SECRET", "local-demo-secret-change-me").encode()


def issue_access_token(user_id: str, lifetime_seconds: int = 3600) -> tuple[str, int]:
    now = int(time.time())
    header = _encode_part({"alg": "HS256", "typ": "JWT"})
    payload = _encode_part({"sub": user_id, "iat": now, "exp": now + lifetime_seconds})
    body = f"{header}.{payload}"
    signature = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).rstrip(b"=").decode()
    return f"{body}.{encoded_signature}", lifetime_seconds


def read_access_token(token: str) -> str:
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
    except ValueError as exc:
        raise InvalidToken("invalid token structure") from exc

    header = _decode_part(encoded_header)
    if header.get("alg") != "HS256" or header.get("typ") != "JWT":
        raise InvalidToken("unsupported token")

    body = f"{encoded_header}.{encoded_payload}"
    expected = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
    padding = "=" * (-len(encoded_signature) % 4)
    try:
        actual = base64.urlsafe_b64decode(encoded_signature + padding)
    except ValueError as exc:
        raise InvalidToken("invalid token signature") from exc
    if not hmac.compare_digest(actual, expected):
        raise InvalidToken("invalid token signature")

    payload = _decode_part(encoded_payload)
    subject = payload.get("sub")
    expires_at = payload.get("exp")
    if not isinstance(subject, str) or not isinstance(expires_at, int):
        raise InvalidToken("invalid token claims")
    if expires_at <= int(time.time()):
        raise InvalidToken("token expired")
    return subject
