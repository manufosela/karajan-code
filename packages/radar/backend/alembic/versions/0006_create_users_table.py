"""Create users table and seed admin user

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-20
"""

import contextlib
import os
from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Pre-computed bcrypt hash for "OFR2026!"
# Generated via: bcrypt.hashpw(b"OFR2026!", bcrypt.gensalt()).decode()
ADMIN_PASSWORD_HASH = "$2b$12$LJ3m4ys3LzVNqKPaYFQwFOGHjKnDVaJXqzBcGjN7rV3dI5kXyE6Gq"


def upgrade() -> None:
    users_table = op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), primary_key=True, default=uuid4),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    # Unique constraint on email. SQLite may have created it inline.
    with contextlib.suppress(Exception):
        op.create_unique_constraint("uq_users_email", "users", ["email"])

    # Seed the initial admin from the environment. Never from a literal: a
    # default account with a known password is a backdoor in every deployment
    # that runs this migration. If the variables are absent, no user is
    # created and the first account must be provisioned explicitly.
    admin_email = os.getenv("SEED_ADMIN_EMAIL", "").strip()
    admin_password = os.getenv("SEED_ADMIN_PASSWORD", "")

    if not admin_email or not admin_password:
        print("0006: SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set; no admin user seeded.")
        return

    import bcrypt

    op.bulk_insert(
        users_table,
        [
            {
                "id": uuid4(),
                "email": admin_email,
                "password_hash": bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode(),
                "name": os.getenv("SEED_ADMIN_NAME", "Administrator"),
                "is_admin": True,
                "is_active": True,
            }
        ],
    )


def downgrade() -> None:
    op.drop_table("users")
