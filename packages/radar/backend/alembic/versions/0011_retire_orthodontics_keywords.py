"""Remove the orthodontics keyword row from the configuration table

`thematic/orthodontics_keywords` was the last piece of a domain living in the
database rather than in the Radar Profile. Nothing reads it any more: the
keyword panel takes its groups from `taxonomy.keyword_groups` in the profile
(KRD-TSK-0023), and the topics endpoint stopped serving the key.

The seed (0002) is left as it was: history is not rewritten, so an instance
built from scratch still passes through the row and loses it here.

downgrade() does not put the row back. It held domain data nobody consumed,
and a resurrected row would look like a setting and not be one, which is the
very confusion this removes.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text("DELETE FROM configuration WHERE category = 'thematic' AND key = 'orthodontics_keywords'")
    )


def downgrade() -> None:
    """Nothing to restore: see the module docstring."""
