"""Record the injection scan performed on each research item

Nullable on purpose. NULL means the item was ingested before the scan
existed and nobody has looked at it; a stored record with no findings means
it was scanned and came out clean. Collapsing the two would make an
unscanned corpus indistinguishable from a clean one, which is the single
most misleading thing this column could do.

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("research_items", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "injection_scan",
                postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite"),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("research_items", schema=None) as batch_op:
        batch_op.drop_column("injection_scan")
