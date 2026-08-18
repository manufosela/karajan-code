"""Update time_horizon check constraint and column width

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    # Drop old constraint, widen column, add new constraint
    if is_pg:
        op.drop_constraint("chk_time_horizon", "research_items", type_="check")
        op.alter_column(
            "research_items",
            "time_horizon",
            type_=sa.String(15),
            existing_type=sa.String(10),
        )
        op.create_check_constraint(
            "chk_time_horizon",
            "research_items",
            "time_horizon IS NULL OR time_horizon IN ('immediate', 'short_term', 'medium_term', 'long_term')",
        )
    else:
        # SQLite: batch mode for alter
        with op.batch_alter_table("research_items") as batch_op:
            batch_op.alter_column(
                "time_horizon",
                type_=sa.String(15),
                existing_type=sa.String(10),
            )


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.drop_constraint("chk_time_horizon", "research_items", type_="check")
        op.alter_column(
            "research_items",
            "time_horizon",
            type_=sa.String(10),
            existing_type=sa.String(15),
        )
        op.create_check_constraint(
            "chk_time_horizon",
            "research_items",
            "time_horizon IS NULL OR time_horizon IN ('short', 'medium', 'long')",
        )
    else:
        with op.batch_alter_table("research_items") as batch_op:
            batch_op.alter_column(
                "time_horizon",
                type_=sa.String(10),
                existing_type=sa.String(15),
            )
