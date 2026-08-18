"""Remove from the configuration table the delivery settings that are domain

The threshold, the item count, the output language and the sections moved to
the Radar Profile (KRD-TSK-0011), where a domain judgement can be reviewed in
a pull request instead of edited as a row in production.

Leaving them here would be worse than a duplicate: they never governed
anything -- the digest read module constants and nobody passed them along --
so a row that stays looks like a setting and is not one. What remains is what
genuinely belongs to a deployment: when the digest runs, and where it is sent.

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-09
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KEY = "daily_digest_settings"

# Moved to the Radar Profile as `delivery` (and, for the language,
# `summary.languages`, which already declared it).
_MOVED_TO_PROFILE = ("teams_threshold", "max_daily_insights", "output_language", "include_sections")

# What downgrade() puts back: the values the seed originally had, since these
# never changed at run time.
_SEEDED_VALUES = {
    "teams_threshold": 6.0,
    "max_daily_insights": 5,
    "output_language": "both",
    "include_sections": [
        "top_insights",
        "strategic_summary",
        "new_opportunities",
        "follow_up_items",
    ],
}


def _rewrite(mutate) -> None:
    """Apply a change to the delivery row, if the row is there at all.

    An instance seeded before this migration has the row; a fresh database
    built from a profile may not. Neither case is an error.
    """
    connection = op.get_bind()
    row = connection.execute(
        sa.text("SELECT value FROM configuration WHERE category = 'delivery' AND key = :key"),
        {"key": _KEY},
    ).scalar()

    if row is None:
        return

    value = json.loads(row) if isinstance(row, str) else dict(row)
    mutate(value)

    connection.execute(
        sa.text("UPDATE configuration SET value = :value WHERE category = 'delivery' AND key = :key"),
        {"value": json.dumps(value), "key": _KEY},
    )


def upgrade() -> None:
    def drop_domain_keys(value: dict) -> None:
        for key in _MOVED_TO_PROFILE:
            value.pop(key, None)

    _rewrite(drop_domain_keys)


def downgrade() -> None:
    def restore_seeded_values(value: dict) -> None:
        value.update(_SEEDED_VALUES)

    _rewrite(restore_seeded_values)
