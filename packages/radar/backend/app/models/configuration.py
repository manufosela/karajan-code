from typing import Any

from sqlalchemy import CheckConstraint, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Configuration(Base):
    """SQLAlchemy model for the configuration table."""

    __tablename__ = "configuration"

    category: Mapped[str] = mapped_column(String(20), nullable=False)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint("category", "key", name="uq_configuration_category_key"),
        CheckConstraint(
            "category IN ('thematic', 'scoring', 'delivery', 'llm', 'general', 'sources')",
            name="chk_config_category",
        ),
    )

    def __repr__(self) -> str:
        return f"<Configuration(id={self.id}, category='{self.category}', key='{self.key}')>"
