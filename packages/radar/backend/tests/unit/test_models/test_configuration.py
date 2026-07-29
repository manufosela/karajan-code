"""Tests for the Configuration SQLAlchemy model."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.configuration import Configuration


@pytest.mark.asyncio
async def test_create_configuration(test_session: AsyncSession):
    """Create a configuration entry with all required fields."""
    config = Configuration(
        category="general",
        key="test_setting",
        value={"enabled": True, "threshold": 0.5},
        description="A test configuration entry",
    )
    test_session.add(config)
    await test_session.flush()

    assert config.id is not None
    assert config.category == "general"
    assert config.key == "test_setting"
    assert config.value == {"enabled": True, "threshold": 0.5}
    assert config.description == "A test configuration entry"


@pytest.mark.asyncio
async def test_configuration_unique_category_key(test_session: AsyncSession):
    """The (category, key) pair must be unique."""
    config1 = Configuration(
        category="thematic",
        key="keywords",
        value={"words": ["test"]},
    )
    config2 = Configuration(
        category="thematic",
        key="keywords",  # same category+key
        value={"words": ["other"]},
    )
    test_session.add(config1)
    await test_session.flush()

    test_session.add(config2)
    with pytest.raises(IntegrityError):
        await test_session.flush()


@pytest.mark.asyncio
async def test_configuration_same_key_different_category(test_session: AsyncSession):
    """Same key in different categories should be allowed."""
    config1 = Configuration(
        category="scoring",
        key="weights",
        value={"a": 0.5},
    )
    config2 = Configuration(
        category="delivery",
        key="weights",
        value={"b": 0.3},
    )
    test_session.add_all([config1, config2])
    await test_session.flush()

    assert config1.id != config2.id


@pytest.mark.asyncio
async def test_configuration_description_nullable(test_session: AsyncSession):
    """Description should be nullable."""
    config = Configuration(
        category="llm",
        key="model",
        value={"provider": "anthropic"},
    )
    test_session.add(config)
    await test_session.flush()

    assert config.description is None


@pytest.mark.asyncio
async def test_configuration_query_by_category(test_session: AsyncSession):
    """Query configurations by category."""
    config1 = Configuration(category="thematic", key="k1", value={"v": 1})
    config2 = Configuration(category="scoring", key="k2", value={"v": 2})
    config3 = Configuration(category="thematic", key="k3", value={"v": 3})
    test_session.add_all([config1, config2, config3])
    await test_session.flush()

    result = await test_session.execute(
        select(Configuration).where(Configuration.category == "thematic")
    )
    thematic = result.scalars().all()
    assert len(thematic) == 2


@pytest.mark.asyncio
async def test_configuration_update_value(test_session: AsyncSession):
    """Update configuration value."""
    config = Configuration(
        category="general",
        key="version",
        value={"version": "1.0.0"},
    )
    test_session.add(config)
    await test_session.flush()

    config.value = {"version": "1.1.0"}
    await test_session.flush()

    result = await test_session.get(Configuration, config.id)
    assert result.value == {"version": "1.1.0"}


@pytest.mark.asyncio
async def test_configuration_repr(test_session: AsyncSession):
    """Configuration.__repr__ should return meaningful string."""
    config = Configuration(category="llm", key="settings", value={"k": "v"})
    test_session.add(config)
    await test_session.flush()

    repr_str = repr(config)
    assert "Configuration" in repr_str
    assert "llm" in repr_str
    assert "settings" in repr_str
