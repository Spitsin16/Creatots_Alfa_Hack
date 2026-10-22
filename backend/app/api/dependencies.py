"""Database and authenticated-user dependencies."""

from collections.abc import Iterator
from datetime import date

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.errors import APIError
from app.db import make_session_factory
from app.models import Membership, User
from app.security import InvalidToken, read_access_token

bearer = HTTPBearer(auto_error=False)


def get_session(request: Request) -> Iterator[Session]:
    if request.app.state.session_factory is None:
        request.app.state.session_factory = make_session_factory(request.app.state.database_url)
    with request.app.state.session_factory() as session:
        yield session


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise APIError(401, "UNAUTHORIZED", "Требуется вход")
    try:
        user_id = read_access_token(credentials.credentials)
    except InvalidToken as exc:
        raise APIError(401, "UNAUTHORIZED", "Сессия недействительна или истекла") from exc
    user = session.get(User, user_id)
    if user is None:
        raise APIError(401, "UNAUTHORIZED", "Пользователь не найден")
    return user


def require_membership(session: Session, user: User, business_id: str, permission: str) -> Membership:
    membership = session.get(Membership, (user.id, business_id))
    if membership is None:
        raise APIError(403, "BUSINESS_ACCESS_DENIED", "Нет доступа к организации")
    if membership.valid_to is not None and membership.valid_to < date.today():
        raise APIError(403, "MEMBERSHIP_EXPIRED", "Срок полномочий истёк")
    if permission not in membership.permissions:
        raise APIError(403, "PERMISSION_DENIED", f"Нет полномочия {permission}")
    return membership
