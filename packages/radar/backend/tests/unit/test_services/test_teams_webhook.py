"""Tests for TeamsWebhookService."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.teams_webhook import TeamsWebhookService


@pytest.fixture
def sample_adaptive_card() -> dict:
    """Sample Adaptive Card payload for testing."""
    return {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": [
            {
                "type": "TextBlock",
                "text": "OFR Daily Digest - 2026-03-20",
                "size": "Large",
                "weight": "Bolder",
            }
        ],
    }


class TestTeamsWebhookServiceInit:
    """Tests for TeamsWebhookService initialization."""

    def test_init_with_url(self) -> None:
        """Service stores the webhook URL."""
        service = TeamsWebhookService(webhook_url="https://hooks.example.com/webhook")
        assert service.webhook_url == "https://hooks.example.com/webhook"

    def test_init_without_url(self) -> None:
        """Service can be created without a URL (None)."""
        service = TeamsWebhookService(webhook_url=None)
        assert service.webhook_url is None


class TestTeamsWebhookSendCard:
    """Tests for send_card method."""

    async def test_send_card_success(self, sample_adaptive_card: dict) -> None:
        """send_card returns True on successful delivery (200)."""
        service = TeamsWebhookService(webhook_url="https://hooks.example.com/webhook")

        mock_response = httpx.Response(status_code=200, text="1")
        with patch("app.services.teams_webhook.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await service.send_card(sample_adaptive_card)

        assert result is True
        mock_client.post.assert_called_once()
        call_kwargs = mock_client.post.call_args
        assert call_kwargs[0][0] == "https://hooks.example.com/webhook"

    async def test_send_card_no_url_configured(self, sample_adaptive_card: dict) -> None:
        """send_card returns False when no webhook URL is configured."""
        service = TeamsWebhookService(webhook_url=None)

        result = await service.send_card(sample_adaptive_card)

        assert result is False

    async def test_send_card_custom_url_overrides_default(self, sample_adaptive_card: dict) -> None:
        """send_card uses custom URL when provided."""
        service = TeamsWebhookService(webhook_url="https://default.example.com/webhook")

        mock_response = httpx.Response(status_code=200, text="1")
        with patch("app.services.teams_webhook.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await service.send_card(
                sample_adaptive_card, webhook_url="https://custom.example.com/webhook"
            )

        assert result is True
        call_kwargs = mock_client.post.call_args
        assert call_kwargs[0][0] == "https://custom.example.com/webhook"

    async def test_send_card_wraps_in_message(self, sample_adaptive_card: dict) -> None:
        """send_card wraps the Adaptive Card in a Teams message envelope."""
        service = TeamsWebhookService(webhook_url="https://hooks.example.com/webhook")

        mock_response = httpx.Response(status_code=200, text="1")
        with patch("app.services.teams_webhook.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            await service.send_card(sample_adaptive_card)

        call_kwargs = mock_client.post.call_args
        posted_json = call_kwargs[1]["json"]
        assert posted_json["type"] == "message"
        assert "attachments" in posted_json
        assert posted_json["attachments"][0]["contentType"] == "application/vnd.microsoft.card.adaptive"
        assert posted_json["attachments"][0]["content"] == sample_adaptive_card


class TestTeamsWebhookRetry:
    """Tests for retry behavior on transient errors."""

    async def test_retry_on_429(self, sample_adaptive_card: dict) -> None:
        """send_card retries on HTTP 429 and succeeds on subsequent attempt."""
        service = TeamsWebhookService(webhook_url="https://hooks.example.com/webhook")

        response_429 = httpx.Response(status_code=429, text="Too Many Requests")
        response_200 = httpx.Response(status_code=200, text="1")

        with patch("app.services.teams_webhook.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.side_effect = [response_429, response_200]
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await service.send_card(sample_adaptive_card)

        assert result is True
        assert mock_client.post.call_count == 2

    async def test_retry_on_500(self, sample_adaptive_card: dict) -> None:
        """send_card retries on HTTP 5xx and succeeds on subsequent attempt."""
        service = TeamsWebhookService(webhook_url="https://hooks.example.com/webhook")

        response_500 = httpx.Response(status_code=500, text="Internal Server Error")
        response_200 = httpx.Response(status_code=200, text="1")

        with patch("app.services.teams_webhook.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.side_effect = [response_500, response_200]
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await service.send_card(sample_adaptive_card)

        assert result is True
        assert mock_client.post.call_count == 2

    async def test_fails_after_max_retries(self, sample_adaptive_card: dict) -> None:
        """send_card returns False after exhausting all retry attempts."""
        service = TeamsWebhookService(webhook_url="https://hooks.example.com/webhook")

        response_500 = httpx.Response(status_code=500, text="Internal Server Error")

        with patch("app.services.teams_webhook.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = response_500
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await service.send_card(sample_adaptive_card)

        assert result is False
        assert mock_client.post.call_count == 3  # initial + 2 retries

    async def test_no_retry_on_4xx(self, sample_adaptive_card: dict) -> None:
        """send_card does not retry on non-retryable 4xx errors (e.g., 400)."""
        service = TeamsWebhookService(webhook_url="https://hooks.example.com/webhook")

        response_400 = httpx.Response(status_code=400, text="Bad Request")

        with patch("app.services.teams_webhook.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = response_400
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await service.send_card(sample_adaptive_card)

        assert result is False
        assert mock_client.post.call_count == 1

    async def test_handles_connection_error(self, sample_adaptive_card: dict) -> None:
        """send_card returns False on connection errors."""
        service = TeamsWebhookService(webhook_url="https://hooks.example.com/webhook")

        with patch("app.services.teams_webhook.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await service.send_card(sample_adaptive_card)

        assert result is False
