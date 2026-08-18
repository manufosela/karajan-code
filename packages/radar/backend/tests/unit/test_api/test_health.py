"""Tests for health and readiness endpoints."""

import uuid

from httpx import AsyncClient


class TestHealthEndpoint:
    """Tests for GET /health."""

    async def test_health_endpoint_returns_200(self, client: AsyncClient) -> None:
        """GET /health returns 200 with status, version, timestamp."""
        response = await client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "version" in data
        assert "timestamp" in data
        assert data["status"] in ("ok", "degraded")
        assert isinstance(data["version"], str)
        assert len(data["version"]) > 0

    async def test_health_includes_database_status(self, client: AsyncClient) -> None:
        """Response includes database field indicating DB health."""
        response = await client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert "database" in data
        assert isinstance(data["database"], str)

    async def test_health_version_matches_settings(self, client: AsyncClient, test_settings) -> None:
        """Health version matches the application settings version."""
        response = await client.get("/health")

        data = response.json()
        assert data["version"] == test_settings.APP_VERSION


class TestReadyEndpoint:
    """Tests for GET /ready."""

    async def test_ready_endpoint_when_healthy(self, client: AsyncClient) -> None:
        """GET /ready returns 200 with ready status and checks dict."""
        response = await client.get("/ready")

        assert response.status_code == 200
        data = response.json()
        assert "ready" in data
        assert "checks" in data
        assert isinstance(data["ready"], bool)
        assert isinstance(data["checks"], dict)

    async def test_ready_checks_include_database(self, client: AsyncClient) -> None:
        """Ready checks include a database check entry."""
        response = await client.get("/ready")

        data = response.json()
        assert "database" in data["checks"]
        assert isinstance(data["checks"]["database"], bool)


class TestRequestIdMiddleware:
    """Tests for X-Request-ID middleware."""

    async def test_request_id_header_present(self, client: AsyncClient) -> None:
        """All responses include an X-Request-ID header."""
        response = await client.get("/health")

        assert response.status_code == 200
        assert "x-request-id" in response.headers
        # Verify it is a valid UUID
        request_id = response.headers["x-request-id"]
        uuid.UUID(request_id)  # raises ValueError if not a valid UUID

    async def test_request_id_propagated(self, client: AsyncClient) -> None:
        """If X-Request-ID is sent in request, the same ID is returned."""
        custom_id = str(uuid.uuid4())
        response = await client.get("/health", headers={"X-Request-ID": custom_id})

        assert response.status_code == 200
        assert response.headers["x-request-id"] == custom_id

    async def test_request_id_on_api_endpoint(self, client: AsyncClient) -> None:
        """X-Request-ID header is present on API v1 endpoints too."""
        response = await client.get("/api/v1/signals")

        assert "x-request-id" in response.headers

    async def test_request_id_on_not_found(self, client: AsyncClient) -> None:
        """X-Request-ID header is present even on 404 responses."""
        fake_id = str(uuid.uuid4())
        response = await client.get(f"/api/v1/signals/{fake_id}")

        assert "x-request-id" in response.headers


class TestCorsHeaders:
    """Tests for CORS middleware configuration."""

    async def test_cors_headers_present(self, client: AsyncClient) -> None:
        """CORS headers are included when Origin header is sent."""
        response = await client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )

        assert "access-control-allow-origin" in response.headers
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"

    async def test_cors_allows_credentials(self, client: AsyncClient) -> None:
        """CORS is configured to allow credentials."""
        response = await client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )

        assert response.headers.get("access-control-allow-credentials") == "true"

    async def test_cors_allows_all_methods(self, client: AsyncClient) -> None:
        """CORS allows all HTTP methods."""
        response = await client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )

        allowed_methods = response.headers.get("access-control-allow-methods", "")
        # FastAPI CORSMiddleware with allow_methods=["*"] lists common methods
        assert "POST" in allowed_methods or "*" in allowed_methods
