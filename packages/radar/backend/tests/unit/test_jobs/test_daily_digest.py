"""Unit tests for the daily digest Cloud Run job."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.jobs.daily_digest import main


def _setup_session_mock():
    """Create a mock async session factory returning an async context manager."""
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_factory = MagicMock()
    mock_factory.return_value = mock_session
    return mock_factory, mock_session


class TestDailyDigestMain:
    """Tests for the daily_digest.main() async entry point."""

    @patch("app.jobs.daily_digest.engine", new_callable=AsyncMock)
    @patch("app.jobs.daily_digest.DigestService")
    @patch("app.jobs.daily_digest.async_session_factory")
    async def test_digest_delivered_returns_zero(self, mock_session_factory, mock_digest_cls, mock_engine):
        """A digest that gets generated and delivered returns exit code 0."""
        mock_factory, _ = _setup_session_mock()
        mock_session_factory.return_value = mock_factory.return_value

        service = mock_digest_cls.return_value
        service.trigger = AsyncMock(return_value=MagicMock(delivery_status="sent"))

        exit_code = await main()

        assert exit_code == 0
        service.trigger.assert_awaited_once()
        # The job asks for delivery, not just generation.
        assert service.trigger.await_args.kwargs.get("deliver") is True
        mock_engine.dispose.assert_awaited_once()

    @patch("app.jobs.daily_digest.engine", new_callable=AsyncMock)
    @patch("app.jobs.daily_digest.DigestService")
    @patch("app.jobs.daily_digest.async_session_factory")
    async def test_no_signals_returns_zero(self, mock_session_factory, mock_digest_cls, mock_engine):
        """No content above the profile threshold is a normal, successful run."""
        mock_factory, _ = _setup_session_mock()
        mock_session_factory.return_value = mock_factory.return_value

        service = mock_digest_cls.return_value
        service.trigger = AsyncMock(return_value=None)

        exit_code = await main()

        assert exit_code == 0
        mock_engine.dispose.assert_awaited_once()

    @patch("app.jobs.daily_digest.engine", new_callable=AsyncMock)
    @patch("app.jobs.daily_digest.DigestService")
    @patch("app.jobs.daily_digest.async_session_factory")
    async def test_trigger_exception_returns_one(self, mock_session_factory, mock_digest_cls, mock_engine):
        """When trigger raises, main() returns exit code 1 and still disposes the engine."""
        mock_factory, _ = _setup_session_mock()
        mock_session_factory.return_value = mock_factory.return_value

        service = mock_digest_cls.return_value
        service.trigger = AsyncMock(side_effect=RuntimeError("DB connection lost"))

        exit_code = await main()

        assert exit_code == 1
        mock_engine.dispose.assert_awaited_once()

    @patch("app.jobs.daily_digest.engine", new_callable=AsyncMock)
    @patch("app.jobs.daily_digest.TeamsWebhookService")
    @patch("app.jobs.daily_digest.DigestService")
    @patch("app.jobs.daily_digest.async_session_factory")
    @patch("app.jobs.daily_digest.settings")
    async def test_teams_webhook_built_from_settings(
        self, mock_settings, mock_session_factory, mock_digest_cls, mock_teams_cls, mock_engine
    ):
        """The Teams webhook is built from TEAMS_WEBHOOK_URL and passed to the service."""
        mock_settings.TEAMS_WEBHOOK_URL = "https://example.test/webhook"
        mock_factory, _ = _setup_session_mock()
        mock_session_factory.return_value = mock_factory.return_value

        service = mock_digest_cls.return_value
        service.trigger = AsyncMock(return_value=None)

        await main()

        mock_teams_cls.assert_called_once_with(webhook_url="https://example.test/webhook")
        assert mock_digest_cls.call_args.kwargs.get("teams_webhook") is mock_teams_cls.return_value

    async def test_sigterm_sets_shutdown_event(self):
        """SIGTERM handler sets the shutdown event."""
        from app.jobs.daily_digest import _create_shutdown_handler

        event = asyncio.Event()
        handler = _create_shutdown_handler(event)
        handler()
        assert event.is_set()
