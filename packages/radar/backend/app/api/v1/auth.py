"""Authentication and user management endpoints."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_superadmin
from app.core.config import settings
from app.models.user import User
from app.schemas.auth import (
    ActiveUserResponse,
    LoginRequest,
    LoginResponse,
    UserCreate,
    UserResponse,
    UserUpdate,
)

router = APIRouter()

TOKEN_EXPIRY_HOURS = 24

# Users with last_active_at within this many minutes are considered "active"
ACTIVE_THRESHOLD_MINUTES = 15


def _hash_password(password: str) -> str:
    """Hash a plain-text password with bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    """Check a plain-text password against a bcrypt hash."""
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def _create_token(user: User) -> str:
    """Create a signed JWT for the given user."""
    now = datetime.now(UTC)
    payload = {
        "user_id": str(user.id),
        "email": user.email,
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(hours=TOKEN_EXPIRY_HOURS),
    }
    return jwt.encode(payload, settings.APP_SECRET_KEY, algorithm="HS256")


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    """Authenticate a user with email and password, return JWT token."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not _verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    token = _create_token(user)
    return LoginResponse(token=token, user=UserResponse.model_validate(user))


@router.post("/logout")
async def logout() -> dict[str, str]:
    """Logout endpoint. The client is responsible for discarding the token."""
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Return the currently authenticated user's information."""
    return UserResponse.model_validate(current_user)


@router.get("/active-users", response_model=list[ActiveUserResponse])
async def get_active_users(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[ActiveUserResponse]:
    """Return users who have been active within the last 15 minutes."""
    threshold = datetime.now(UTC) - timedelta(minutes=ACTIVE_THRESHOLD_MINUTES)
    result = await db.execute(
        select(User).where(
            User.is_active == True,  # noqa: E712
            User.last_active_at != None,  # noqa: E711
            User.last_active_at >= threshold,
        )
    )
    users = result.scalars().all()
    return [ActiveUserResponse.model_validate(u) for u in users]


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_superadmin),
) -> list[UserResponse]:
    """List all users (superadmin only)."""
    result = await db.execute(select(User).order_by(User.created_at))
    users = result.scalars().all()
    return [UserResponse.model_validate(u) for u in users]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_superadmin),
) -> UserResponse:
    """Create a new user (superadmin only)."""
    # Check if email already exists
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    user = User(
        email=body.email,
        password_hash=_hash_password(body.password),
        name=body.name,
        role=body.role,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_superadmin),
) -> UserResponse:
    """Update an existing user (superadmin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if body.name is not None:
        user.name = body.name
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        user.password_hash = _hash_password(body.password)

    await db.flush()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.delete("/users/{user_id}", response_model=UserResponse)
async def deactivate_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> UserResponse:
    """Deactivate a user (superadmin only). Does not delete the record."""
    if admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own account",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user.is_active = False
    await db.flush()
    await db.refresh(user)
    return UserResponse.model_validate(user)
