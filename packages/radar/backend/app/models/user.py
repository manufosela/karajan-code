"""User model for authentication and authorization."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class User(Base):
    """Application user with authentication credentials."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="user", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_active_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    # The users time columns are timestamptz (migration 0010, KRD-TSK-0014);
    # override the naive created_at/updated_at inherited from Base so model and
    # database agree.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    @property
    def is_superadmin(self) -> bool:
        """Check if user has superadmin role."""
        return self.role == "superadmin"

    @property
    def is_admin(self) -> bool:
        """Check if user has admin or superadmin role.

        Kept as a computed property for backwards compatibility with existing code.
        """
        return self.role in ("superadmin", "admin")
