"""Unit tests for the daily ingestion Cloud Run job."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.jobs.daily_ingestion import main


def _mock_ingestion_run(source_id="src-001", status="completed", fetched=10, new=8, dup=2, errors=None):
    """Create a mock IngestionRun."""
    run = MagicMock()
    run.status = status
    run.items_fetched = fetched
    run.items_new = new
    run.items_duplicate = dup
    run.errors = errors or []
    run.source_id = source_id
    return run


def _setup_session_mock():
    """Create a mock async session factory that returns an async context manager."""
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_factory = MagicMock()
    mock_factory.return_value = mock_session
    return mock_factory, mock_session


class TestDailyIngestionMain:
    """Tests for the daily_ingestion.main() async entry point."""

    @patch("app.jobs.daily_ingestion.engine", new_callable=AsyncMock)
    @patch("app.jobs.daily_ingestion.get_provider", side_effect=Exception("No API key"))
    @patch("app.jobs.daily_ingestion.create_default_registry")
    @patch("app.jobs.daily_ingestion.async_session_factory")
    async def test_successful_run_returns_zero(
        self, mock_session_factory, mock_create_registry, mock_get_provider, mock_engine
    ):
        """Successful ingestion run returns exit code 0 (even without LLM provider)."""
        runs = [_mock_ingestion_run("src-001"), _mock_ingestion_run("src-002", fetched=5, new=3, dup=2)]
        mock_factory, mock_session = _setup_session_mock()
        mock_session_factory.return_value = mock_factory.return_value

        with patch("app.jobs.daily_ingestion.IngestionOrchestrator") as mock_orch:
            mock_orch_instance = AsyncMock()
            mock_orch_instance.run_all = AsyncMock(return_value=runs)
            mock_orch.return_value = mock_orch_instance

            exit_code = await main()

        assert exit_code == 0
        mock_engine.dispose.assert_awaited_once()

    @patch("app.jobs.daily_ingestion.engine", new_callable=AsyncMock)
    @patch("app.jobs.daily_ingestion.create_default_registry")
    @patch("app.jobs.daily_ingestion.async_session_factory")
    async def test_orchestrator_exception_returns_one(
        self, mock_session_factory, mock_create_registry, mock_engine
    ):
        """When orchestrator raises, main() returns exit code 1."""
        mock_factory, mock_session = _setup_session_mock()
        mock_session_factory.return_value = mock_factory.return_value

        with patch("app.jobs.daily_ingestion.IngestionOrchestrator") as mock_orch:
            mock_orch_instance = AsyncMock()
            mock_orch_instance.run_all = AsyncMock(side_effect=RuntimeError("DB connection lost"))
            mock_orch.return_value = mock_orch_instance

            exit_code = await main()

        assert exit_code == 1
        mock_engine.dispose.assert_awaited_once()

    @patch("app.jobs.daily_ingestion.engine", new_callable=AsyncMock)
    @patch("app.jobs.daily_ingestion.get_provider", side_effect=Exception("No key"))
    @patch("app.jobs.daily_ingestion.create_default_registry")
    @patch("app.jobs.daily_ingestion.async_session_factory")
    async def test_no_enabled_sources_returns_zero(
        self, mock_session_factory, mock_create_registry, mock_get_provider, mock_engine
    ):
        """Empty results (no enabled sources) returns exit code 0."""
        mock_factory, mock_session = _setup_session_mock()
        mock_session_factory.return_value = mock_factory.return_value

        with patch("app.jobs.daily_ingestion.IngestionOrchestrator") as mock_orch:
            mock_orch_instance = AsyncMock()
            mock_orch_instance.run_all = AsyncMock(return_value=[])
            mock_orch.return_value = mock_orch_instance

            exit_code = await main()

        assert exit_code == 0

    @patch("app.jobs.daily_ingestion.engine", new_callable=AsyncMock)
    @patch("app.jobs.daily_ingestion.create_default_registry")
    @patch("app.jobs.daily_ingestion.async_session_factory")
    async def test_engine_disposed_on_failure(self, mock_session_factory, mock_create_registry, mock_engine):
        """Engine is always disposed, even on failure."""
        mock_factory, mock_session = _setup_session_mock()
        mock_session_factory.return_value = mock_factory.return_value

        with patch("app.jobs.daily_ingestion.IngestionOrchestrator") as mock_orch:
            mock_orch_instance = AsyncMock()
            mock_orch_instance.run_all = AsyncMock(side_effect=Exception("fatal"))
            mock_orch.return_value = mock_orch_instance

            exit_code = await main()

        assert exit_code == 1
        mock_engine.dispose.assert_awaited_once()

    @patch("app.jobs.daily_ingestion.engine", new_callable=AsyncMock)
    @patch("app.jobs.daily_ingestion.get_provider", side_effect=Exception("No key"))
    @patch("app.jobs.daily_ingestion.create_default_registry")
    @patch("app.jobs.daily_ingestion.async_session_factory")
    async def test_failed_runs_included_in_summary(
        self, mock_session_factory, mock_create_registry, mock_get_provider, mock_engine
    ):
        """Failed connector runs still return 0 (orchestrator didn't raise)."""
        runs = [
            _mock_ingestion_run("src-001", status="completed", fetched=10, new=8, dup=2),
            _mock_ingestion_run(
                "src-002", status="failed", fetched=0, new=0, dup=0, errors=[{"message": "timeout"}]
            ),
        ]
        mock_factory, mock_session = _setup_session_mock()
        mock_session_factory.return_value = mock_factory.return_value

        with patch("app.jobs.daily_ingestion.IngestionOrchestrator") as mock_orch:
            mock_orch_instance = AsyncMock()
            mock_orch_instance.run_all = AsyncMock(return_value=runs)
            mock_orch.return_value = mock_orch_instance

            exit_code = await main()

        assert exit_code == 0

    async def test_sigterm_sets_shutdown_event(self):
        """SIGTERM handler sets the shutdown event."""
        from app.jobs.daily_ingestion import _create_shutdown_handler

        event = asyncio.Event()
        handler = _create_shutdown_handler(event)
        handler()
        assert event.is_set()
