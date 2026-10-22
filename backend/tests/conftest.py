from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import Base, make_engine
from app.main import create_app
from app.seed import seed_all


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'api.db'}"
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("DEMO_SIGN_CODE", "0000")
    engine = make_engine(database_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session, session.begin():
        seed_all(session)
    with TestClient(create_app(database_url)) as client:
        yield client
