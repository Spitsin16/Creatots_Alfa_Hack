"""The CI service exercises the migration on PostgreSQL 16."""

import os
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from alembic import command
from app.models import Business, Rule
from app.seed import seed_all


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL", "").startswith("postgresql+psycopg://"),
    reason="PostgreSQL CI service is not running",
)
def test_postgres_migration_and_seed() -> None:
    url = os.environ["DATABASE_URL"]
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    engine = create_engine(url)
    with Session(engine) as session:
        with session.begin():
            seed_all(session)
        assert session.scalar(select(func.count()).select_from(Business)) == 7
        assert session.get(Rule, 1).active
