"""Админ правил: версии rules.yaml в БД, прогон на персонах, включение и откат.

Сохранение = новая версия; включённая версия одна. Решения хранят `rules_version`,
поэтому старые заявки остаются объяснимыми.
"""

from datetime import UTC, datetime

import yaml as yamllib
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_session
from app.api.errors import APIError
from app.models import AuditLog, DataSnapshot, Rule, User
from app.services.scoring.simulate import RulesError, parse_rules, simulate

router = APIRouter(prefix="/api/v1/bank/rules", tags=["rules"])
BANK_ROLES = {"UNDERWRITER", "RISK_MANAGER", "RULES_ADMIN"}


class RulesIn(BaseModel):
    """Правила — либо YAML-текстом, либо структурой (форма в кабинете админа)."""

    yaml: str | None = Field(default=None, min_length=10, max_length=200_000)
    rules: dict | None = None
    comment: str = Field(default="", max_length=500)
    activate: bool = False

    def text(self) -> str:
        if self.rules is not None:
            return yamllib.safe_dump(self.rules, allow_unicode=True, sort_keys=False)
        if self.yaml is None:
            raise APIError(422, "RULES_INVALID", "Передайте правила")
        return self.yaml


def _role(user: User, *roles: str) -> None:
    if user.role not in roles:
        raise APIError(403, "ROLE_DENIED", "Недостаточно прав")


def _active(session: Session) -> Rule:
    rule = session.scalar(select(Rule).where(Rule.active.is_(True)).order_by(Rule.version.desc()))
    if rule is None:
        raise APIError(503, "RULES_UNAVAILABLE", "Нет активной версии правил")
    return rule


def _personas(session: Session) -> list[dict]:
    by_business: dict[str, dict] = {}
    for snap in session.scalars(select(DataSnapshot)):
        by_business.setdefault(snap.business_id, {})[snap.source.lower()] = snap.payload
    out = []
    for data in by_business.values():
        if {"profile", "alfa", "registry", "fns", "bki"}.issubset(data):
            out.append({"persona": data["profile"], **{k: data[k] for k in ("alfa", "registry", "fns", "bki")}})
    return sorted(out, key=lambda p: p["persona"]["id"])


def _check(session: Session, text: str) -> tuple[dict, list[dict]]:
    try:
        new_rules = parse_rules(text)
        rows = simulate(parse_rules(_active(session).yaml), new_rules, _personas(session))
    except RulesError as exc:
        raise APIError(422, "RULES_INVALID", str(exc)) from exc
    return new_rules, rows


@router.get("")
def list_rules(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    _role(user, *BANK_ROLES)
    rules = session.scalars(select(Rule).order_by(Rule.version.desc())).all()
    active = next((r for r in rules if r.active), None)
    return {
        "active_version": active.version if active else None,
        "active_yaml": active.yaml if active else None,
        "active_rules": yamllib.safe_load(active.yaml) if active else None,
        "versions": [{"version": r.version, "active": r.active, "author_id": r.author_id, "created_at": r.created_at}
                     for r in rules],
    }


@router.post("/simulate")
def simulate_rules(payload: RulesIn, user: User = Depends(get_current_user),
                   session: Session = Depends(get_session)) -> dict:
    _role(user, "RULES_ADMIN")
    _, rows = _check(session, payload.text())
    return {"base_version": _active(session).version, "personas": rows,
            "changed": sum(r["changed"] for r in rows)}


@router.post("", status_code=201)
def create_rules(payload: RulesIn, user: User = Depends(get_current_user),
                 session: Session = Depends(get_session)) -> dict:
    _role(user, "RULES_ADMIN")
    text = payload.text()
    _, rows = _check(session, text)
    version = (session.scalar(select(func.max(Rule.version))) or 0) + 1
    rule = Rule(version=version, yaml=text, author_id=user.id, active=False, created_at=datetime.now(UTC))
    session.add(rule)
    session.flush()
    session.add(AuditLog(actor_id=user.id, action="RULES_VERSION_CREATED", entity="rules", entity_id=str(version),
                         before=None, after={"comment": payload.comment, "changed_personas": [r["persona"] for r in rows if r["changed"]]}))
    if payload.activate:
        _activate(session, user, rule)
    session.commit()
    return {"version": version, "active": rule.active, "personas": rows}


def _activate(session: Session, user: User, rule: Rule) -> None:
    previous = session.scalar(select(Rule).where(Rule.active.is_(True)))
    for r in session.scalars(select(Rule).where(Rule.active.is_(True))):
        r.active = False
    rule.active = True
    session.add(AuditLog(actor_id=user.id, action="RULES_ACTIVATED", entity="rules", entity_id=str(rule.version),
                         before={"active_version": previous.version if previous else None},
                         after={"active_version": rule.version}))


@router.post("/{version}/activate")
def activate_rules(version: int, user: User = Depends(get_current_user),
                   session: Session = Depends(get_session)) -> dict:
    """Включить версию — в том числе откатиться на прежнюю."""
    _role(user, "RULES_ADMIN")
    rule = session.get(Rule, version)
    if rule is None:
        raise APIError(404, "RULES_NOT_FOUND", "Версия правил не найдена")
    _activate(session, user, rule)
    session.commit()
    return {"active_version": version}
