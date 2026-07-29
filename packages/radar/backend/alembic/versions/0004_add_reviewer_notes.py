"""Add reviewer_notes column to research_items

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("research_items", sa.Column("reviewer_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("research_items", "reviewer_notes")
