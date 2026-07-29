from datetime import date, datetime
from typing import Any

from sqlalchemy import CheckConstraint, Date, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DailyDigest(Base):
    """SQLAlchemy model for the daily_digests table."""

    __tablename__ = "daily_digests"

    digest_date: Mapped[date] = mapped_column(Date, nullable=False)
    items_included: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    delivery_channel: Mapped[str] = mapped_column(String(10), nullable=False)
    delivery_status: Mapped[str] = mapped_column(
        String(15),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    sent_at: Mapped[datetime | None] = mapped_column()

    __table_args__ = (
        CheckConstraint(
            "delivery_channel IN ('teams', 'email')",
            name="chk_delivery_channel",
        ),
        CheckConstraint(
            "delivery_status IN ('pending', 'sent', 'failed')",
            name="chk_delivery_status",
        ),
    )

    # Note: daily_digests has created_at but no updated_at in the schema.
    # The base class provides both; this is acceptable since it doesn't conflict.

    def __repr__(self) -> str:
        return f"<DailyDigest(id={self.id}, date={self.digest_date}, channel='{self.delivery_channel}')>"
