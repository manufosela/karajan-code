from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, CheckConstraint, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.ingestion_run import IngestionRun
    from app.models.research_item import ResearchItem


class Source(Base):
    """SQLAlchemy model for the sources table."""

    __tablename__ = "sources"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default="5")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    config: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    base_url: Mapped[str | None] = mapped_column(Text)
    last_fetched_at: Mapped[datetime | None] = mapped_column()

    __table_args__ = (
        CheckConstraint(
            "source_type IN ('api', 'rss', 'scraper')",
            name="chk_source_type",
        ),
        CheckConstraint(
            "category IN ('core', 'university', 'journal', 'author')",
            name="chk_source_category",
        ),
        CheckConstraint(
            "priority BETWEEN 1 AND 10",
            name="chk_source_priority",
        ),
    )

    research_items: Mapped[list["ResearchItem"]] = relationship(  # noqa: F821
        back_populates="source",
        lazy="raise",
    )
    ingestion_runs: Mapped[list["IngestionRun"]] = relationship(  # noqa: F821
        back_populates="source",
        lazy="raise",
    )

    def __repr__(self) -> str:
        return f"<Source(id={self.id}, name='{self.name}', type='{self.source_type}')>"
