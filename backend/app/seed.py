"""Idempotent seed of synthetic users, businesses, snapshots, and rules v1."""

import json
from datetime import date
from pathlib import Path

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import make_engine
from app.models import Business, DataSnapshot, Membership, Rule, Segment, User
from app.passwords import hash_password

DATA = Path(__file__).resolve().parents[2] / "data"


def seed_rules(session: Session, data_dir: Path = DATA) -> None:
    raw = (data_dir / "rules.yaml").read_text(encoding="utf-8")
    version = yaml.safe_load(raw)["version"]
    existing = session.get(Rule, version)
    if existing is None:
        session.add(Rule(version=version, yaml=raw, active=True))
    elif existing.yaml != raw:
        raise ValueError(f"rules_v{version} differs from persisted version; create a new version")


def seed_personas(session: Session, data_dir: Path = DATA) -> None:
    for path in sorted((data_dir / "personas").glob("p*.json")):
        fixture = json.loads(path.read_text(encoding="utf-8"))
        registry = fixture["registry"]
        profile = fixture["persona"]
        user = session.scalar(select(User).where(User.login == profile["login"]))
        if user is None:
            user = User(
                full_name=fixture["alfa"]["person"]["full_name"],
                login=profile["login"], role="CLIENT",
                password_hash=hash_password(profile["password"]),
            )
            session.add(user)
            session.flush()
        business = session.scalar(select(Business).where(Business.inn == registry["inn"]))
        if business is None:
            business = Business(
                inn=registry["inn"], ogrn=registry["ogrn"], type=registry["type"],
                name=registry["name"], okved=registry["okved"],
                reg_date=date.fromisoformat(registry["reg_date"]),
                status=registry["status"], tax_regime=fixture["fns"]["regime"],
            )
            session.add(business)
            session.flush()
        if session.get(Membership, (user.id, business.id)) is None:
            session.add(Membership(
                user_id=user.id, business_id=business.id,
                kind="OWNER" if registry["type"] == "IP" else "DIRECTOR",
                permissions=["VIEW", "FILL", "CONSENT", "SUBMIT", "SIGN"],
            ))
        if session.scalar(select(Segment).where(Segment.business_id == business.id)) is None:
            session.add(Segment(business_id=business.id, code=profile["segment"], flags={}))
        for source in ("alfa", "registry", "fns", "bki"):
            if session.scalar(select(DataSnapshot).where(
                DataSnapshot.business_id == business.id, DataSnapshot.source == source.upper(),
            )) is None:
                session.add(DataSnapshot(
                    business_id=business.id, source=source.upper(),
                    payload=fixture[source], status="OK",
                ))
        for employee in profile.get("employees", []):
            member = session.scalar(select(User).where(User.login == employee["login"]))
            if member is None:
                member = User(
                    full_name=employee["full_name"], login=employee["login"],
                    role="CLIENT", password_hash=hash_password(employee["password"]),
                )
                session.add(member)
                session.flush()
            if session.get(Membership, (member.id, business.id)) is None:
                session.add(Membership(
                    user_id=member.id, business_id=business.id, kind="MCHD",
                    permissions=employee["mchd"]["permissions"],
                    valid_to=date.fromisoformat(employee["mchd"]["valid_to"]),
                ))

    bank_users = json.loads((data_dir / "personas/bank_users.json").read_text(encoding="utf-8"))
    for entry in bank_users:
        if session.scalar(select(User).where(User.login == entry["login"])) is None:
            session.add(User(
                full_name=entry["full_name"], login=entry["login"], role=entry["role"],
                password_hash=hash_password(entry["password"]),
            ))


def seed_all(session: Session, data_dir: Path = DATA) -> None:
    seed_rules(session, data_dir)
    seed_personas(session, data_dir)


def main() -> None:
    engine = make_engine()
    with Session(engine) as session, session.begin():
        seed_all(session)
    print("Synthetic fixtures and rules loaded")


if __name__ == "__main__":
    main()
