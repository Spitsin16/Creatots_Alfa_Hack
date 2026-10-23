"""document storage: files table, business documents

Revision ID: 9d2f4b7c1a3e
Revises: 7c1e5a2b9d40
Create Date: 2026-10-23 06:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "9d2f4b7c1a3e"
down_revision: Union[str, Sequence[str], None] = "7c1e5a2b9d40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "files",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("documents") as batch:
        batch.alter_column("application_id", existing_type=sa.String(length=36), nullable=True)
        batch.add_column(sa.Column("business_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("title", sa.String(length=200), nullable=True))
        batch.add_column(sa.Column("uploaded_by", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("valid_to", sa.Date(), nullable=True))
        batch.add_column(
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True)
        )
        batch.create_foreign_key("fk_documents_business_id", "businesses", ["business_id"], ["id"])
        batch.create_foreign_key("fk_documents_uploaded_by", "users", ["uploaded_by"], ["id"])
        batch.create_index("ix_documents_business_id", ["business_id"])


def downgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.drop_index("ix_documents_business_id")
        batch.drop_constraint("fk_documents_uploaded_by", type_="foreignkey")
        batch.drop_constraint("fk_documents_business_id", type_="foreignkey")
        for column in ("created_at", "valid_to", "uploaded_by", "title", "business_id"):
            batch.drop_column(column)
        batch.alter_column("application_id", existing_type=sa.String(length=36), nullable=False)
    op.drop_table("files")
