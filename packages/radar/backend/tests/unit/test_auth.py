"""Tests for the authentication and user management endpoints."""

import uuid

import bcrypt
import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


@pytest.fixture
async def admin_user(test_session: AsyncSession) -> User:
    """Seed a superadmin user into the test database."""
    user = User(
        id=uuid.uuid4(),
        email="admin@test.com",
        password_hash=_hash("Admin123!"),
        name="Admin User",
        role="superadmin",
        is_active=True,
    )
    test_session.add(user)
    await test_session.commit()
    await test_session.refresh(user)
    return user


@pytest.fixture
async def normal_user(test_session: AsyncSession) -> User:
    """Seed a regular user into the test database."""
    user = User(
        id=uuid.uuid4(),
        email="user@test.com",
        password_hash=_hash("User1234!"),
        name="Normal User",
        role="user",
        is_active=True,
    )
    test_session.add(user)
    await test_session.commit()
    await test_session.refresh(user)
    return user


@pytest.fixture
async def admin_role_user(test_session: AsyncSession) -> User:
    """Seed an admin (non-superadmin) user into the test database."""
    user = User(
        id=uuid.uuid4(),
        email="moderator@test.com",
        password_hash=_hash("Mod12345!"),
        name="Moderator User",
        role="admin",
        is_active=True,
    )
    test_session.add(user)
    await test_session.commit()
    await test_session.refresh(user)
    return user


@pytest.fixture
async def inactive_user(test_session: AsyncSession) -> User:
    """Seed an inactive user into the test database."""
    user = User(
        id=uuid.uuid4(),
        email="inactive@test.com",
        password_hash=_hash("Pass1234!"),
        name="Inactive User",
        role="user",
        is_active=False,
    )
    test_session.add(user)
    await test_session.commit()
    await test_session.refresh(user)
    return user


async def _login(client: AsyncClient, email: str, password: str) -> dict:
    """Helper to perform login and return response JSON."""
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    return {"status": resp.status_code, "body": resp.json()}


async def _get_token(client: AsyncClient, email: str, password: str) -> str:
    """Helper to login and return just the JWT token."""
    result = await _login(client, email, password)
    return result["body"]["token"]


# ─── Login ──────────────────────────────────────────────────────


class TestLogin:
    async def test_login_success(self, client: AsyncClient, admin_user: User) -> None:
        result = await _login(client, "admin@test.com", "Admin123!")
        assert result["status"] == 200
        assert "token" in result["body"]
        assert result["body"]["user"]["email"] == "admin@test.com"
        assert result["body"]["user"]["role"] == "superadmin"

    async def test_login_wrong_password(self, client: AsyncClient, admin_user: User) -> None:
        result = await _login(client, "admin@test.com", "wrong")
        assert result["status"] == 401

    async def test_login_nonexistent_email(self, client: AsyncClient) -> None:
        result = await _login(client, "nobody@test.com", "whatever")
        assert result["status"] == 401

    async def test_login_inactive_user(self, client: AsyncClient, inactive_user: User) -> None:
        result = await _login(client, "inactive@test.com", "Pass1234!")
        assert result["status"] == 403

    async def test_jwt_contains_expected_claims(self, client: AsyncClient, admin_user: User) -> None:
        result = await _login(client, "admin@test.com", "Admin123!")
        token = result["body"]["token"]
        payload = jwt.decode(token, settings.APP_SECRET_KEY, algorithms=["HS256"])
        assert payload["email"] == "admin@test.com"
        assert payload["role"] == "superadmin"
        assert "exp" in payload
        assert "user_id" in payload


# ─── /auth/me ───────────────────────────────────────────────────


class TestMe:
    async def test_me_authenticated(self, client: AsyncClient, admin_user: User) -> None:
        token = await _get_token(client, "admin@test.com", "Admin123!")
        resp = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == "admin@test.com"

    async def test_me_no_token(self, client: AsyncClient) -> None:
        resp = await client.get("/api/v1/auth/me")
        assert resp.status_code == 401

    async def test_me_invalid_token(self, client: AsyncClient) -> None:
        resp = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert resp.status_code == 401


# ─── Logout ─────────────────────────────────────────────────────


class TestLogout:
    async def test_logout(self, client: AsyncClient) -> None:
        resp = await client.post("/api/v1/auth/logout")
        assert resp.status_code == 200
        assert resp.json()["message"] == "Logged out successfully"


# ─── User Management (admin only) ──────────────────────────────


class TestUserManagement:
    async def test_list_users_admin(self, client: AsyncClient, admin_user: User) -> None:
        token = await _get_token(client, "admin@test.com", "Admin123!")
        resp = await client.get(
            "/api/v1/auth/users",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert len(resp.json()) >= 1

    async def test_list_users_non_admin(self, client: AsyncClient, normal_user: User) -> None:
        token = await _get_token(client, "user@test.com", "User1234!")
        resp = await client.get(
            "/api/v1/auth/users",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    async def test_create_user_admin(self, client: AsyncClient, admin_user: User) -> None:
        token = await _get_token(client, "admin@test.com", "Admin123!")
        resp = await client.post(
            "/api/v1/auth/users",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "email": "new@test.com",
                "password": "NewPass123!",
                "name": "New User",
                "role": "user",
            },
        )
        assert resp.status_code == 201
        assert resp.json()["email"] == "new@test.com"
        assert resp.json()["role"] == "user"

    async def test_create_user_duplicate_email(self, client: AsyncClient, admin_user: User) -> None:
        token = await _get_token(client, "admin@test.com", "Admin123!")
        resp = await client.post(
            "/api/v1/auth/users",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "email": "admin@test.com",
                "password": "Whatever1!",
                "name": "Duplicate",
            },
        )
        assert resp.status_code == 409

    async def test_update_user_admin(self, client: AsyncClient, admin_user: User, normal_user: User) -> None:
        token = await _get_token(client, "admin@test.com", "Admin123!")
        resp = await client.patch(
            f"/api/v1/auth/users/{normal_user.id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "Updated Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"

    async def test_deactivate_user_admin(self, client: AsyncClient, admin_user: User, normal_user: User) -> None:
        token = await _get_token(client, "admin@test.com", "Admin123!")
        resp = await client.delete(
            f"/api/v1/auth/users/{normal_user.id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    async def test_admin_role_cannot_manage_users(
        self, client: AsyncClient, admin_role_user: User
    ) -> None:
        """Admin role (non-superadmin) should not be able to list or create users."""
        token = await _get_token(client, "moderator@test.com", "Mod12345!")
        resp = await client.get(
            "/api/v1/auth/users",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    async def test_cannot_deactivate_self(self, client: AsyncClient, admin_user: User) -> None:
        token = await _get_token(client, "admin@test.com", "Admin123!")
        resp = await client.delete(
            f"/api/v1/auth/users/{admin_user.id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    async def test_create_user_non_admin(self, client: AsyncClient, normal_user: User) -> None:
        token = await _get_token(client, "user@test.com", "User1234!")
        resp = await client.post(
            "/api/v1/auth/users",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "email": "another@test.com",
                "password": "Pass1234!",
                "name": "Another",
            },
        )
        assert resp.status_code == 403
