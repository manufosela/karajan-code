import asyncio
import uuid
from collections.abc import AsyncGenerator
from typing import Any

import bcrypt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import StaticPool
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.deps import get_db, get_settings
from app.core.config import Settings
from app.models import Base
from app.models.user import User

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# Map PostgreSQL JSONB to generic JSON so SQLite can handle it.
# This must be registered before create_all is called.
from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_: JSONB, compiler, **kwargs):  # type: ignore[no-untyped-def]
    return "JSON"


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    """Override settings for testing."""
    return Settings(
        DATABASE_URL=TEST_DATABASE_URL,
        DEBUG=True,
        LOG_LEVEL="DEBUG",
        ALLOWED_ORIGINS=["http://localhost:3000"],
    )


@pytest.fixture
async def test_engine():
    """Create a test async engine with SQLite in-memory."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def test_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Provide a test database session that rolls back after each test."""
    session_factory = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_factory() as session:
        yield session
        await session.rollback()


@pytest.fixture
async def client(test_engine, test_settings) -> AsyncGenerator[AsyncClient, None]:
    """Provide an async test client with overridden dependencies."""
    from app.main import create_app

    session_factory = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    def override_get_settings() -> Settings:
        return test_settings

    app = create_app()
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = override_get_settings

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


_TEST_ADMIN_EMAIL = "testadmin@test.com"
_TEST_ADMIN_PASSWORD = "TestAdmin123!"


@pytest.fixture
async def auth_headers(client: AsyncClient, test_engine) -> dict[str, str]:
    """Create a superadmin user and return auth headers with a valid JWT token.

    This fixture is used by tests that hit protected endpoints (sources,
    configuration, etc.) and need authentication without being specifically
    about testing auth itself.
    """
    # Create the user directly in the DB
    session_factory = async_sessionmaker(
        bind=test_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        pw_hash = bcrypt.hashpw(
            _TEST_ADMIN_PASSWORD.encode(), bcrypt.gensalt()
        ).decode()
        user = User(
            id=uuid.uuid4(),
            email=_TEST_ADMIN_EMAIL,
            password_hash=pw_hash,
            name="Test Admin",
            role="superadmin",
            is_active=True,
        )
        session.add(user)
        await session.commit()

    # Login to get a token
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": _TEST_ADMIN_EMAIL, "password": _TEST_ADMIN_PASSWORD},
    )
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def sample_source_data() -> dict[str, Any]:
    """Sample source data for testing."""
    return {
        "id": uuid.uuid4(),
        "name": "Test PubMed",
        "source_type": "api",
        "category": "core",
        "priority": 1,
        "enabled": True,
        "config": {"search_endpoint": "esearch.fcgi"},
        "base_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
    }


@pytest.fixture
def sample_research_item_data(sample_source_data: dict[str, Any]) -> dict[str, Any]:
    """Sample research item data for testing."""
    return {
        "source_id": sample_source_data["id"],
        "original_title": "Effect of clear aligners on orthodontic tooth movement: a systematic review",
        "document_type": "review",
        "doi": "10.1234/test.2024.001",
        "pmid": "12345678",
        "authors": [
            {"name": "Smith J.", "affiliation": "University of Testing"},
            {"name": "Doe A.", "affiliation": "Test Medical Center"},
        ],
        "publication_date": "2024-06-15",
        "abstract": "This systematic review evaluates the effectiveness of clear aligners in orthodontic treatment.",
        "journal_or_origin": "Journal of Orthodontics Research",
        "language": "en",
        "thematic_tags": ["clear aligners", "orthodontic treatment", "systematic review"],
        "strategic_buckets": ["product_clinical"],
        "review_status": "review",
    }
