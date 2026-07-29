from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Generic LLM abstraction layer
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Usage:
    """Token usage from an LLM call."""

    prompt_tokens: int
    completion_tokens: int

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass(frozen=True)
class LLMResponse:
    """Response from a generic LLM call."""

    content: str
    model: str
    usage: Usage
    latency_ms: float


class BaseLLMProvider(ABC):
    """Abstract base for generic LLM providers.

    Defines a low-level interface (complete / complete_json) that concrete
    providers (OpenAI, Anthropic, …) must implement.
    """

    @abstractmethod
    async def complete(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        """Send a prompt and return a free-text response."""
        ...

    @abstractmethod
    async def complete_json(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        schema: dict | None = None,
    ) -> dict:
        """Send a prompt and return a structured JSON response.

        Concrete providers should enforce that the response matches *schema*
        (JSON Schema dict) when provided.
        """
        ...


# ---------------------------------------------------------------------------
# Domain-specific LLM layer (higher-level, used by ingestion pipeline)
# ---------------------------------------------------------------------------


@dataclass
class LLMConfig:
    """Configuration for an LLM provider."""

    provider: str
    model: str
    temperature: float = 0.2
    max_tokens: int = 4096
    api_key: str | None = None
    timeout: float = 60.0
    retry_attempts: int = 3
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class LLMTaskResponse:
    """Structured response from a domain-specific LLM task."""

    result: dict[str, Any]
    raw_input: str
    raw_output: str
    provider: str
    model: str
    prompt_version: str
    tokens_used: int | None = None
    latency_ms: float | None = None


class LLMProvider(ABC):
    """Abstract interface for domain-specific LLM tasks.

    Subclasses implement the actual API calls to OpenAI, Anthropic, etc.
    Each method accepts a document's data and returns a structured LLMTaskResponse
    with both the parsed result and the raw input/output for audit trail.
    """

    def __init__(self, config: LLMConfig) -> None:
        self.config = config

    @abstractmethod
    async def classify_document(
        self,
        title: str,
        abstract: str | None,
        authors: list[dict[str, Any]] | None = None,
        journal: str | None = None,
        document_type: str | None = None,
        prompt_version: str = "v1.0.0",
    ) -> LLMTaskResponse:
        """Classify a document: assign thematic tags, strategic buckets, and document type.

        Returns an LLMTaskResponse where result contains:
        - thematic_tags: list[str]
        - strategic_buckets: list[str]
        - document_type: str (if reclassified)
        """
        ...

    @abstractmethod
    async def score_document(
        self,
        title: str,
        abstract: str | None,
        document_type: str | None = None,
        journal: str | None = None,
        thematic_tags: list[str] | None = None,
        prompt_version: str = "v1.0.0",
    ) -> LLMTaskResponse:
        """Score a document for scientific strength and strategic relevance.

        Returns an LLMTaskResponse where result contains:
        - scientific_strength_score: float (0-10)
        - scientific_strength_reasons: dict
        - strategic_relevance_score: float (0-10)
        - strategic_relevance_reasons: dict
        - hype_risk: str (low/medium/high)
        - time_horizon: str (short/medium/long)
        - recommended_action: str (monitor/investigate/test/discard)
        - confidence_level: float (0-1)
        """
        ...

    @abstractmethod
    async def generate_strategic_insight(
        self,
        title: str,
        abstract: str | None,
        scores: dict[str, Any] | None = None,
        classification: dict[str, Any] | None = None,
        prompt_version: str = "v1.0.0",
    ) -> LLMTaskResponse:
        """Generate strategic insight summaries for a document.

        Returns an LLMTaskResponse where result contains:
        - executive_summary_en: str
        - executive_summary_es: str
        - why_it_matters_en: str
        - why_it_matters_es: str
        - possible_impact_en: str
        - possible_impact_es: str
        - facts_from_source: dict
        - extracted_evidence: dict
        - evidence_snippets: dict
        - strategic_interpretation: dict
        """
        ...
