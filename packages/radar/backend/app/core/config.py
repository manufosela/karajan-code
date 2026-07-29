
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/frontier_radar"

    APP_NAME: str = "Frontier Radar"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    PORT: int = 8080

    # The Radar Profile that defines this instance's domain: taxonomy,
    # vocabularies, prompts and sources. See backend/profiles/.
    ACTIVE_PROFILE: str = "orthodontics"
    PROFILES_DIR: str | None = None

    # Deployment-specific. Production origins belong in the environment, not
    # in the source: a public repository must not carry a customer's hostnames.
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:3002",
        "http://localhost:3003",
    ]

    # Cloud Scheduler job to keep in sync with the ingestion schedule, as a
    # fully qualified name: projects/<project>/locations/<region>/jobs/<job>.
    # Unset means no Cloud Scheduler integration.
    SCHEDULER_JOB_NAME: str | None = None

    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None

    PUBMED_API_KEY: str | None = None
    SEMANTIC_SCHOLAR_API_KEY: str | None = None
    CROSSREF_MAILTO: str | None = None

    TEAMS_WEBHOOK_URL: str | None = None

    LOG_LEVEL: str = "INFO"

    # Which LLM backend and models to use is declared by the active Radar
    # Profile (its `llm` section), not here: it is part of what defines a
    # radar instance. Credentials stay in the environment.
    OLLAMA_BASE_URL: str | None = None

    APP_SECRET_KEY: str  # Required - must be set via env var or .env

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


settings = Settings()
