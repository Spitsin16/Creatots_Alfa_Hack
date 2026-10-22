from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.orm import Session

from alembic import command
from app.db import Base
from app.models import Business, DataSnapshot, Membership, Rule, User
from app.passwords import verify_password
from app.seed import DATA, seed_all, seed_rules

BACKEND = Path(__file__).resolve().parents[1]


def test_initial_migration_and_idempotent_seed(tmp_path: Path) -> None:
    db_url = f"sqlite+pysqlite:///{tmp_path / 'credit.db'}"
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", db_url)
    command.upgrade(config, "head")

    engine = create_engine(db_url)
    assert set(inspect(engine).get_table_names()) == set(Base.metadata.tables) | {"alembic_version"}

    with Session(engine) as session:
        with session.begin():
            seed_all(session)
        with session.begin():
            seed_all(session)
        assert session.scalar(select(func.count()).select_from(Business)) == 7
        assert session.scalar(select(func.count()).select_from(User)) == 12
        assert session.scalar(select(func.count()).select_from(Membership)) == 8
        assert session.scalar(select(func.count()).select_from(DataSnapshot)) == 28
        assert session.scalar(select(func.count()).select_from(Rule)) == 1
        assert verify_password("demo", session.scalar(select(User).where(User.login == "p3b")).password_hash)
        assert not verify_password("wrong", session.scalar(select(User).where(User.login == "p3b")).password_hash)


def test_rules_version_is_immutable(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'rules.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        with session.begin():
            seed_rules(session)
        rule = session.get(Rule, 1)
        rule.yaml = "different"
        session.commit()
        with pytest.raises(ValueError, match="create a new version"):
            seed_rules(session, DATA)
