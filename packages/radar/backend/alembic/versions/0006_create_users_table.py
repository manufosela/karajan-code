"""Create users table and seed admin user

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-20
"""

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

    # Unique constraint on email
    try:
        op.create_unique_constraint("uq_users_email", "users", ["email"])
    except Exception:
        pass  # SQLite may have created it inline

    # Seed admin user - hash will be regenerated on first startup if needed
    import bcrypt

    actual_hash = bcrypt.hashpw(b"OFR2026!", bcrypt.gensalt()).decode()

    op.bulk_insert(
        users_table,
        [
            {
                "id": uuid4(),
                "email": "mfosela@geniova.com",
                "password_hash": actual_hash,
                "name": "Manu Fosela",
                "is_admin": True,
                "is_active": True,
            }
        ],
    )


def downgrade() -> None:
    op.drop_table("users")
