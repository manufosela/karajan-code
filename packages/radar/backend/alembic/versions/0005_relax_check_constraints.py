"""Relax check constraints to match actual LLM service output values

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-20

Values are the UNION of all LLM service outputs:
- scoring.py: hype_risk={low,medium,high}, recommended_action={monitor,investigate,test,discard}
- impact.py: hype_risk={low,medium,high}, recommended_action={monitor,investigate,act_now,archive}
- strategic.py: time_horizon={immediate,short_term,medium_term,long_term}
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Widen string columns - use batch mode for SQLite compatibility
    with op.batch_alter_table("research_items") as batch_op:
        batch_op.alter_column("hype_risk", type_=sa.String(20))
        batch_op.alter_column("recommended_action", type_=sa.String(20))
        batch_op.alter_column("time_horizon", type_=sa.String(20))

    # Drop old restrictive constraints (ignored silently on SQLite)
    try:
        op.drop_constraint("chk_recommended_action", "research_items", type_="check")
        op.drop_constraint("chk_hype_risk", "research_items", type_="check")
        op.drop_constraint("chk_time_horizon", "research_items", type_="check")
    except Exception:
        pass  # SQLite doesn't support named constraints

    # Re-create with values matching ACTUAL LLM service outputs
    # Skip on SQLite (no constraint support)
    try:
        op.create_check_constraint(
            "chk_recommended_action",
            "research_items",
            "recommended_action IS NULL OR recommended_action IN "
            "('monitor', 'investigate', 'test', 'discard', 'act_now', 'archive')",
        )
        op.create_check_constraint(
            "chk_hype_risk",
            "research_items",
            "hype_risk IS NULL OR hype_risk IN ('low', 'medium', 'high')",
        )
        op.create_check_constraint(
            "chk_time_horizon",
            "research_items",
            "time_horizon IS NULL OR time_horizon IN ('immediate', 'short_term', 'medium_term', 'long_term')",
        )
    except NotImplementedError:
        pass  # SQLite doesn't support check constraints


def downgrade() -> None:
    with op.batch_alter_table("research_items") as batch_op:
        batch_op.alter_column("hype_risk", type_=sa.String(10))
        batch_op.alter_column("recommended_action", type_=sa.String(15))
        batch_op.alter_column("time_horizon", type_=sa.String(15))

    try:
        op.drop_constraint("chk_recommended_action", "research_items", type_="check")
        op.drop_constraint("chk_hype_risk", "research_items", type_="check")
        op.drop_constraint("chk_time_horizon", "research_items", type_="check")
    except Exception:
        pass

    try:
        op.create_check_constraint(
            "chk_recommended_action",
            "research_items",
            "recommended_action IS NULL OR recommended_action IN "
            "('monitor', 'investigate', 'test', 'discard')",
        )
        op.create_check_constraint(
            "chk_hype_risk",
            "research_items",
            "hype_risk IS NULL OR hype_risk IN ('low', 'medium', 'high')",
        )
        op.create_check_constraint(
            "chk_time_horizon",
            "research_items",
            "time_horizon IS NULL OR time_horizon IN ('immediate', 'short_term', 'medium_term', 'long_term')",
        )
    except NotImplementedError:
        pass
