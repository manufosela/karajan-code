"""Add role column to users table and last_active_at tracking

Revision ID: 0007
Revises: 0006
Create Date: 2026-03-23
"""

import contextlib
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Use batch_alter_table for SQLite compatibility
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("role", sa.String(20), nullable=False, server_default="user"))
        batch_op.add_column(sa.Column("last_active_at", sa.DateTime(), nullable=True))

    # SQLite cannot add check constraints after table creation.
    with contextlib.suppress(Exception):
        op.create_check_constraint(
            "ck_users_role",
            "users",
            "role IN ('superadmin', 'admin', 'user')",
        )

    # Migrate existing is_admin=True users to role='superadmin'
    op.execute("UPDATE users SET role = 'superadmin' WHERE is_admin = true")
    # Migrate existing is_admin=False users to role='user'
    op.execute("UPDATE users SET role = 'user' WHERE is_admin = false")

    # Remove the old is_admin column
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("is_admin")


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.text("false"))
        )

    # Migrate role back to is_admin
    op.execute("UPDATE users SET is_admin = true WHERE role IN ('superadmin', 'admin')")
    op.execute("UPDATE users SET is_admin = false WHERE role = 'user'")

    # Drop check constraint. SQLite does not support dropping it.
    with contextlib.suppress(Exception):
        op.drop_constraint("ck_users_role", "users", type_="check")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("last_active_at")
        batch_op.drop_column("role")
