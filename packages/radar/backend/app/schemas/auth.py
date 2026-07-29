"""Authentication and user management schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


VALID_ROLES = ("superadmin", "admin", "user")


class LoginRequest(BaseModel):
    """Credentials for user login."""

    email: EmailStr
    password: str = Field(..., min_length=1)


class UserResponse(BaseModel):
    """Public user information returned by the API."""

    id: UUID
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    """Successful login response with JWT token and user info."""

    token: str
    user: UserResponse


class UserCreate(BaseModel):
    """Schema for creating a new user (superadmin only)."""

    email: EmailStr
    password: str = Field(..., min_length=6)
    name: str = Field(..., min_length=1, max_length=255)
    role: str = "user"

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v


class UserUpdate(BaseModel):
    """Schema for updating an existing user (superadmin only)."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=6)

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v


class ActiveUserResponse(BaseModel):
    """Minimal user info for the active-users endpoint."""

    id: UUID
    name: str
    email: str
    role: str
    last_active_at: datetime | None = None

    model_config = {"from_attributes": True}
