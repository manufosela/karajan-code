import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/ortho_frontier_radar"

    APP_NAME: str = "Ortho Frontier Radar"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    PORT: int = 8080

    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:3002",
        "http://localhost:3003",
        "https://ofr-frontend-721262691356.europe-southwest1.run.app",
        "https://ofr.geniova.com",
    ]

    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None

    PUBMED_API_KEY: str | None = None
    SEMANTIC_SCHOLAR_API_KEY: str | None = None
    CROSSREF_MAILTO: str | None = None

    TEAMS_WEBHOOK_URL: str | None = None

    LOG_LEVEL: str = "INFO"

    LLM_DEFAULT_PROVIDER: str = "openai"
    LLM_DEFAULT_MODEL: str = "gpt-4o"
    LLM_FAST_MODEL: str = "gpt-4o-mini"

    APP_SECRET_KEY: str  # Required - must be set via env var or .env

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


settings = Settings()
