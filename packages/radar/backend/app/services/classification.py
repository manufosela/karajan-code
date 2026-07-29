"""Classification service for thematic tagging of research items.

Uses an LLM provider to classify research papers into the themes declared by
the active Radar Profile and extract relevant keywords. The themes themselves
are domain configuration, not code.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger
from app.llm.base import BaseLLMProvider
from app.profiles.active import get_prompt_renderer
from app.profiles.renderer import PromptRenderer

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class ClassificationError(Exception):
    """Raised when classification fails (LLM error or invalid response)."""

    def __init__(self, message: str, *, title: str = "") -> None:
        super().__init__(message)
        self.title = title


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ThemeScore:
    """A theme with its confidence score."""

    name: str
    confidence: float


@dataclass(frozen=True)
class ClassificationResult:
    """Result of thematic classification."""

    themes: list[ThemeScore]
    primary_theme: str
    keywords: list[str]


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class ClassificationService:
    """Classifies research items into thematic categories using an LLM.

    Args:
        provider: A BaseLLMProvider instance for LLM calls.
        renderer: Prompt renderer supplying the domain taxonomy. Defaults to
            the renderer bound to the active Radar Profile.
    """

    def __init__(
        self,
        provider: BaseLLMProvider,
        renderer: PromptRenderer | None = None,
    ) -> None:
        self._provider = provider
        self._renderer = renderer if renderer is not None else get_prompt_renderer()

    @property
    def valid_themes(self) -> frozenset[str]:
        """Theme ids the active profile allows."""
        return self._renderer.profile.taxonomy.theme_ids

    async def classify(
        self,
        title: str,
        abstract: str | None,
    ) -> ClassificationResult:
        """Classify a research item by its title and abstract.

        Args:
            title: Research paper title.
            abstract: Research paper abstract (may be None or empty).

        Returns:
            ClassificationResult with themes, primary_theme, and keywords.

        Raises:
            ClassificationError: If the LLM call fails or returns invalid data.
        """
        prompt = self._renderer.render(
            "classification",
            title=title,
            abstract=abstract if abstract else "No abstract available.",
        )

        try:
            response = await self._provider.complete_json(prompt)
        except TimeoutError as exc:
            logger.error("llm_timeout", title=title, error=str(exc))
            raise ClassificationError(
                f"LLM timed out while classifying: {exc}",
                title=title,
            ) from exc
        except ConnectionError as exc:
            logger.error("llm_connection_error", title=title, error=str(exc))
            raise ClassificationError(
                f"LLM connection error: {exc}",
                title=title,
            ) from exc
        except ValueError as exc:
            logger.error("llm_json_error", title=title, error=str(exc))
            raise ClassificationError(
                f"LLM returned invalid JSON: {exc}",
                title=title,
            ) from exc
        except Exception as exc:
            logger.error("llm_unexpected_error", title=title, error=str(exc))
            raise ClassificationError(
                f"LLM classification failed: {exc}",
                title=title,
            ) from exc

        return self._validate_response(response, title=title)

    def _validate_response(
        self,
        data: dict[str, Any],
        *,
        title: str,
    ) -> ClassificationResult:
        """Validate and convert the LLM response into a ClassificationResult.

        Raises:
            ClassificationError: If the response structure is invalid.
        """
        # Check required fields
        missing = [f for f in ("themes", "primary_theme", "keywords") if f not in data]
        if missing:
            raise ClassificationError(
                f"Missing required fields in LLM response: {', '.join(missing)}",
                title=title,
            )

        raw_themes = data["themes"]
        primary_theme = data["primary_theme"]
        keywords = data["keywords"]

        # Validate themes is non-empty
        if not raw_themes:
            raise ClassificationError(
                "LLM returned empty themes list; at least one theme is required",
                title=title,
            )

        # Validate each theme
        themes: list[ThemeScore] = []
        for entry in raw_themes:
            name = entry.get("name", "")
            confidence = entry.get("confidence", 0.0)

            if name not in self.valid_themes:
                raise ClassificationError(
                    f"Invalid theme name '{name}'. Must be one of: {sorted(self.valid_themes)}",
                    title=title,
                )

            if not (0.0 <= confidence <= 1.0):
                raise ClassificationError(
                    f"Confidence for theme '{name}' is {confidence}; must be between 0.0 and 1.0",
                    title=title,
                )

            themes.append(ThemeScore(name=name, confidence=confidence))

        # Validate primary_theme is in themes
        theme_names = {t.name for t in themes}
        if primary_theme not in theme_names:
            raise ClassificationError(
                f"primary_theme '{primary_theme}' is not in the themes list: {sorted(theme_names)}",
                title=title,
            )

        logger.info(
            "classification_complete",
            title=title,
            primary_theme=primary_theme,
            num_themes=len(themes),
            num_keywords=len(keywords),
        )

        return ClassificationResult(
            themes=themes,
            primary_theme=primary_theme,
            keywords=keywords,
        )
