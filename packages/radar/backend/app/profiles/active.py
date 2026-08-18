"""Resolution of the Radar Profile this instance runs on.

The active profile is chosen by configuration (``ACTIVE_PROFILE``), not
discovered at random: an instance watching energy policy and one watching
orthodontic research run the same code and differ only here.

Both accessors are cached because a profile is immutable and reading it on
every classification would mean parsing YAML thousands of times per run.
"""

from __future__ import annotations

from functools import lru_cache

from app.core.config import settings
from app.profiles.loader import load_profile_by_id
from app.profiles.renderer import PromptRenderer
from app.profiles.schema import RadarProfile


@lru_cache(maxsize=1)
def get_active_profile() -> RadarProfile:
    """Load the configured Radar Profile.

    Raises:
        ProfileNotFoundError: If ``ACTIVE_PROFILE`` names no known profile.
        ProfileValidationError: If that profile is invalid.
    """
    return load_profile_by_id(
        settings.ACTIVE_PROFILE,
        profiles_dir=settings.PROFILES_DIR,
    )


@lru_cache(maxsize=1)
def get_prompt_renderer() -> PromptRenderer:
    """The prompt renderer bound to the active profile."""
    return PromptRenderer(get_active_profile())


def default_query_for(connector: str) -> str:
    """The search query the active profile declares for a connector.

    Connectors used to carry a hardcoded fallback query, which silently tied
    every deployment to one subject matter. The query is domain configuration,
    so an absent one is an error rather than something to guess at.

    Raises:
        ValueError: If the active profile declares no query for that connector.
    """
    for source in get_active_profile().sources:
        if source.connector == connector and source.query:
            return source.query

    raise ValueError(
        f"profile '{settings.ACTIVE_PROFILE}' declares no query for connector "
        f"'{connector}'; add one under its sources section"
    )


def reset_active_profile() -> None:
    """Drop the cached profile and renderer.

    Intended for tests and for reloading after configuration changes.
    """
    get_active_profile.cache_clear()
    get_prompt_renderer.cache_clear()
