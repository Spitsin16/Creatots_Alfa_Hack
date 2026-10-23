"""Песочница проверяющего: создать своего синтетического клиента и сразу войти под ним.

Проверяющий задаёт, что о бизнесе знают Альфа, ФНС и БКИ; генератор строит данные,
дальше клиент проходит обычный путь (анкета без вопросов о выручке, предложение,
заявка), а решение считает тот же движок, что и для эталонных персон.
"""

import random
import string

import yaml
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.api.errors import APIError
from app.models import AuditLog, Business, DataSnapshot, Rule, User
from app.security import issue_access_token
from app.seed import seed_fixture
from app.services.sandbox.generator import SandboxParams, build
from app.services.scoring.engine import decide

router = APIRouter(prefix="/api/v1/sandbox", tags=["sandbox"])
MAX_SANDBOX_CLIENTS = 500
OWNERS = ["Орлова Мария Андреевна", "Ковалёв Денис Игоревич", "Смирнова Ольга Петровна", "Никитин Павел Сергеевич",
          "Фёдорова Анна Викторовна", "Григорьев Илья Олегович", "Зуева Екатерина Романовна", "Лебедев Максим Юрьевич"]


class SandboxIn(BaseModel):
    type: str = Field(default="IP", pattern="^(IP|LLC)$")
    industry: str = Field(default="medium", pattern="^(low|medium|high)$")
    age_months: int = Field(default=36, ge=1, le=240)
    revenue: int = Field(default=1_000_000, ge=100_000, le=100_000_000)
    seasonality: str = Field(default="none", pattern="^(none|moderate|strong)$")
    alfa_share: float = Field(default=1.0, ge=0.2, le=1.0)
    alfa_credit: str = Field(default="none", pattern="^(none|good|overdue)$")
    external_balance: int = Field(default=0, ge=0, le=200_000_000)
    external_payment: int = Field(default=0, ge=0, le=20_000_000)
    credit_history: str = Field(default="clean", pattern="^(clean|none|past_lt30|past_gte30)$")
    current_overdue_days: int = Field(default=0, ge=0, le=365)
    tax_debt: int = Field(default=0, ge=0, le=50_000_000)
    real_estate_value: int = Field(default=0, ge=0, le=1_000_000_000)


def _sandbox_count(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(User).where(User.login.like("sbx%"))) or 0


@router.post("/clients", status_code=201)
def create_sandbox_client(payload: SandboxIn, session: Session = Depends(get_session)) -> dict:
    if _sandbox_count(session) >= MAX_SANDBOX_CLIENTS:
        raise APIError(429, "SANDBOX_FULL", "Песочница заполнена — перезапустите стенд")
    params = SandboxParams(**payload.model_dump())
    sid = "sbx" + "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
    try:
        fixture = build(params, sid, random.choice(OWNERS))
    except ValueError as exc:
        raise APIError(422, "SANDBOX_INVALID", str(exc)) from exc
    business = seed_fixture(session, fixture)
    session.flush()
    rule = session.scalar(select(Rule).where(Rule.active.is_(True)).order_by(Rule.version.desc()))
    preview = decide(yaml.safe_load(rule.yaml), fixture, with_advice=False)
    user = session.scalar(select(User).where(User.login == sid))
    session.add(AuditLog(actor_id=user.id, action="SANDBOX_CLIENT_CREATED", entity="business", entity_id=business.id,
                         before=None, after={"params": payload.model_dump(), "score": preview["score"],
                                             "outcome": preview["outcome"]}))
    session.commit()
    token, lifetime = issue_access_token(user.id)
    return {
        "login": sid, "password": "demo", "access_token": token, "expires_in": lifetime,
        "business": {"id": business.id, "name": business.name, "inn": business.inn},
        "preview": {k: preview.get(k) for k in ("score", "cls", "product", "outcome", "limit", "rate", "reason",
                                                 "stop_factors", "binding_constraint")},
        "transactions": len(fixture["alfa"]["transactions"]),
    }


@router.get("/sources/{inn}/{source}")
def sandbox_source(inn: str, source: str, session: Session = Depends(get_session)) -> dict:
    """Для сервиса mocks: данные «внешних систем» по клиенту песочницы (только синтетика)."""
    business = session.scalar(select(Business).where(Business.inn == inn))
    if business is None:
        raise APIError(404, "NOT_FOUND", "ИНН не найден")
    snaps = {s.source.lower(): s.payload for s in
             session.scalars(select(DataSnapshot).where(DataSnapshot.business_id == business.id))}
    if not (snaps.get("profile") or {}).get("sandbox"):
        raise APIError(404, "NOT_FOUND", "ИНН не найден")
    if source == "mchd":
        return {"inn": inn, "powers_of_attorney": []}
    if source not in ("alfa", "registry", "fns", "bki"):
        raise APIError(404, "NOT_FOUND", "Неизвестный источник")
    return {"inn": inn, **snaps[source]}


