"""User model for authentication and authorization."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
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
        DateTime, nullable=True, default=None
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
