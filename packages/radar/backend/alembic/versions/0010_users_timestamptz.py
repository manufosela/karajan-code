"""Make the users time columns timestamptz

The users table was created (0006) and extended (0007) with
`timestamp without time zone` columns, while the rest of the schema uses
`with time zone`. A naive timestamp records a wall-clock reading without
saying where, so it stops meaning anything the moment a process runs outside
UTC, and the symptom shows up far from the cause (KRD-TSK-0014).

`created_at`, `updated_at` and `last_active_at` become timestamptz. The
existing values were written by code that used UTC, so they are interpreted
`AT TIME ZONE 'UTC'` rather than in the session's zone.

SQLite does not distinguish the two types, so this is a no-op there; the real
verification happens on PostgreSQL through the smoke suite (KRD-TSK-0008).

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMNS = ("created_at", "updated_at", "last_active_at")


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for column in _COLUMNS:
        op.alter_column(
            "users",
            column,
            type_=sa.DateTime(timezone=True),
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for column in _COLUMNS:
        op.alter_column(
            "users",
            column,
            type_=sa.DateTime(timezone=False),
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )
