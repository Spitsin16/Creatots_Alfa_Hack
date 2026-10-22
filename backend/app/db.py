"""Database engine and session factory shared by the API and worker."""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(url: str | None = None):
    database_url = url or os.environ["DATABASE_URL"]
    return create_engine(database_url, pool_pre_ping=True)


def make_session_factory(url: str | None = None):
    return sessionmaker(make_engine(url), expire_on_commit=False)
