"""Loading and discovery of Radar Profiles stored as YAML files.

Profiles live in ``backend/profiles/`` by default. Each file is named after
the profile id it declares (``orthodontics.yaml`` holds ``id: orthodontics``),
so an instance can be pointed at a domain with a single identifier.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import ValidationError

from app.profiles.schema import RadarProfile

# backend/app/profiles/loader.py -> backend/profiles
DEFAULT_PROFILES_DIR = Path(__file__).resolve().parents[2] / "profiles"

_YAML_SUFFIXES = (".yaml", ".yml")


class ProfileError(Exception):
    """Base class for Radar Profile loading failures."""


class ProfileNotFoundError(ProfileError):
    """Raised when the requested profile does not exist."""


class ProfileValidationError(ProfileError):
    """Raised when a profile file exists but does not describe a valid profile."""


def load_profile(path: Path | str) -> RadarProfile:
    """Load and validate a Radar Profile from a YAML file.

    Args:
        path: Path to the profile file.

    Returns:
        The validated profile.

    Raises:
        ProfileNotFoundError: If the file does not exist.
        ProfileValidationError: If the file is not valid YAML or does not
            satisfy the Radar Profile schema.
    """
    profile_path = Path(path)

    if not profile_path.is_file():
        raise ProfileNotFoundError(f"no such profile file: {profile_path}")

    raw = profile_path.read_text(encoding="utf-8")

    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ProfileValidationError(f"{profile_path} is not valid YAML: {exc}") from exc

    if not isinstance(data, dict):
        raise ProfileValidationError(
            f"{profile_path} must contain a mapping at the top level, "
            f"got {type(data).__name__}"
        )

    try:
        return RadarProfile.model_validate(data)
    except ValidationError as exc:
        raise ProfileValidationError(f"{profile_path} is not a valid profile: {exc}") from exc


def load_profile_by_id(
    profile_id: str,
    *,
    profiles_dir: Path | str | None = None,
) -> RadarProfile:
    """Load a Radar Profile by its id from a profiles directory.

    Args:
        profile_id: The profile identifier, matching its filename.
        profiles_dir: Directory to search. Defaults to the bundled profiles.

    Returns:
        The validated profile.

    Raises:
        ProfileNotFoundError: If no profile carries that id.
        ProfileValidationError: If the profile is invalid, or if its declared
            id disagrees with its filename.
    """
    directory = Path(profiles_dir) if profiles_dir is not None else DEFAULT_PROFILES_DIR

    profile_path = _resolve_profile_path(profile_id, directory)
    if profile_path is None:
        known = ", ".join(available_profiles(directory)) or "none"
        raise ProfileNotFoundError(
            f"unknown profile id '{profile_id}' in {directory}; available: {known}"
        )

    profile = load_profile(profile_path)

    if profile.id != profile_id:
        raise ProfileValidationError(
            f"{profile_path} declares id '{profile.id}', which does not match "
            f"its filename '{profile_id}'"
        )

    return profile


def available_profiles(profiles_dir: Path | str | None = None) -> list[str]:
    """List the profile ids available in a directory, sorted alphabetically.

    A missing directory yields an empty list rather than an error, so a
    deployment without bundled profiles can still start and report the fact.
    """
    directory = Path(profiles_dir) if profiles_dir is not None else DEFAULT_PROFILES_DIR

    if not directory.is_dir():
        return []

    return sorted(
        entry.stem
        for entry in directory.iterdir()
        if entry.is_file() and entry.suffix in _YAML_SUFFIXES
    )


def _resolve_profile_path(profile_id: str, directory: Path) -> Path | None:
    """Resolve a profile id to a file inside ``directory``, or None if absent.

    The id becomes part of a filename, so a value containing separators or
    parent references is rejected outright rather than allowed to reach
    outside the profiles directory.
    """
    if not profile_id or profile_id != Path(profile_id).name or profile_id in (".", ".."):
        return None

    for suffix in _YAML_SUFFIXES:
        candidate = directory / f"{profile_id}{suffix}"
        if candidate.is_file():
            return candidate

    return None
