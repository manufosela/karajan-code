import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.source import Source


class IngestionRun(Base):
    """SQLAlchemy model for the ingestion_runs table."""

    __tablename__ = "ingestion_runs"

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sources.id", ondelete="RESTRICT"),
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column()
    status: Mapped[str] = mapped_column(
        String(15),
        nullable=False,
        default="running",
        server_default="running",
    )
    items_fetched: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    items_new: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    items_duplicate: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    items_processed: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    errors: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, default=list)

    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'completed', 'failed')",
            name="chk_run_status",
        ),
        CheckConstraint(
            "items_fetched >= 0 AND items_new >= 0 AND items_duplicate >= 0 AND items_processed >= 0",
            name="chk_items_non_negative",
        ),
    )

    # Note: ingestion_runs has created_at but no updated_at in the schema
    # The base class provides both, but the SQL schema only has created_at.
    # We keep updated_at from base since it doesn't cause issues.

    # Relationships
    source: Mapped["Source"] = relationship(  # noqa: F821
        back_populates="ingestion_runs",
    )

    def __repr__(self) -> str:
        return f"<IngestionRun(id={self.id}, source_id={self.source_id}, status='{self.status}')>"
