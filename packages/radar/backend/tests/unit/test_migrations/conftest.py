import os
import sys
from pathlib import Path

import pytest
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parents[3]


@pytest.fixture
def alembic_config(tmp_path):
    """Alembic Config pointing to a temporary SQLite database."""
    db_path = tmp_path / "test.db"
    db_url = f"sqlite:///{db_path}"

    old_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = db_url

    # Ensure app package is importable
    backend_str = str(BACKEND_DIR)
    if backend_str not in sys.path:
        sys.path.insert(0, backend_str)

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))

    yield cfg, db_url

    if old_url is not None:
        os.environ["DATABASE_URL"] = old_url
    else:
        os.environ.pop("DATABASE_URL", None)


@pytest.fixture
def alembic_config_aiosqlite(tmp_path):
    """Alembic Config using sqlite+aiosqlite:// URL (R-1 regression test).

    Verifies that the async SQLite driver prefix is stripped before
    create_engine is called in run_sync_migrations.
    """
    db_path = tmp_path / "test_aiosqlite.db"
    db_url = f"sqlite+aiosqlite:///{db_path}"

    old_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = db_url

    backend_str = str(BACKEND_DIR)
    if backend_str not in sys.path:
        sys.path.insert(0, backend_str)

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))

    # Return the plain sqlite URL for engine inspection (no async prefix)
    sync_url = f"sqlite:///{db_path}"
    yield cfg, sync_url

    if old_url is not None:
        os.environ["DATABASE_URL"] = old_url
    else:
        os.environ.pop("DATABASE_URL", None)
