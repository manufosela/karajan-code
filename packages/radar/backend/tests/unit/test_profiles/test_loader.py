"""Tests for loading Radar Profiles from YAML files on disk."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.profiles.loader import (
    ProfileNotFoundError,
    ProfileValidationError,
    available_profiles,
    load_profile,
    load_profile_by_id,
)

from .test_schema import _minimal_profile_dict


@pytest.fixture
def profiles_dir(tmp_path: Path) -> Path:
    """A directory holding one valid profile named ``test-domain.yaml``."""
    directory = tmp_path / "profiles"
    directory.mkdir()
    (directory / "test-domain.yaml").write_text(yaml.safe_dump(_minimal_profile_dict()), encoding="utf-8")
    return directory


class TestLoadProfile:
    def test_loads_a_valid_profile_from_a_path(self, profiles_dir: Path) -> None:
        profile = load_profile(profiles_dir / "test-domain.yaml")

        assert profile.id == "test-domain"
        assert profile.taxonomy.theme_ids == frozenset({"alpha", "beta"})

    def test_raises_when_the_file_does_not_exist(self, tmp_path: Path) -> None:
        with pytest.raises(ProfileNotFoundError, match="no such profile file"):
            load_profile(tmp_path / "missing.yaml")

    def test_raises_on_malformed_yaml(self, tmp_path: Path) -> None:
        broken = tmp_path / "broken.yaml"
        broken.write_text("id: test\n  name: [unclosed", encoding="utf-8")

        with pytest.raises(ProfileValidationError, match="is not valid YAML"):
            load_profile(broken)

    def test_raises_on_yaml_that_is_not_a_mapping(self, tmp_path: Path) -> None:
        not_a_mapping = tmp_path / "list.yaml"
        not_a_mapping.write_text("- one\n- two\n", encoding="utf-8")

        with pytest.raises(ProfileValidationError, match="must contain a mapping"):
            load_profile(not_a_mapping)

    def test_raises_on_empty_file(self, tmp_path: Path) -> None:
        empty = tmp_path / "empty.yaml"
        empty.write_text("", encoding="utf-8")

        with pytest.raises(ProfileValidationError, match="must contain a mapping"):
            load_profile(empty)

    def test_error_message_names_the_offending_field(self, tmp_path: Path) -> None:
        """A misconfigured profile must say what is wrong, not just fail."""
        data = _minimal_profile_dict()
        data["scoring"]["weights"] = {"a": 0.3, "b": 0.3}
        invalid = tmp_path / "invalid.yaml"
        invalid.write_text(yaml.safe_dump(data), encoding="utf-8")

        with pytest.raises(ProfileValidationError) as excinfo:
            load_profile(invalid)

        message = str(excinfo.value)
        assert "invalid.yaml" in message
        assert "must sum to 1.0" in message

    def test_accepts_a_string_path(self, profiles_dir: Path) -> None:
        profile = load_profile(str(profiles_dir / "test-domain.yaml"))

        assert profile.id == "test-domain"


class TestLoadProfileById:
    def test_loads_by_id(self, profiles_dir: Path) -> None:
        profile = load_profile_by_id("test-domain", profiles_dir=profiles_dir)

        assert profile.name == "Test Domain Radar"

    def test_raises_for_unknown_id_and_lists_what_is_available(self, profiles_dir: Path) -> None:
        with pytest.raises(ProfileNotFoundError) as excinfo:
            load_profile_by_id("nonexistent", profiles_dir=profiles_dir)

        assert "test-domain" in str(excinfo.value)

    def test_rejects_an_id_that_escapes_the_profiles_directory(self, profiles_dir: Path) -> None:
        """A profile id becomes a filename, so path traversal must be refused."""
        with pytest.raises(ProfileNotFoundError):
            load_profile_by_id("../../etc/passwd", profiles_dir=profiles_dir)

    def test_rejects_mismatch_between_id_and_filename(self, profiles_dir: Path) -> None:
        """A profile whose id disagrees with its filename is a configuration bug."""
        data = _minimal_profile_dict()
        data["id"] = "something-else"
        (profiles_dir / "mismatched.yaml").write_text(yaml.safe_dump(data), encoding="utf-8")

        with pytest.raises(ProfileValidationError, match="does not match"):
            load_profile_by_id("mismatched", profiles_dir=profiles_dir)


class TestAvailableProfiles:
    def test_lists_profile_ids(self, profiles_dir: Path) -> None:
        assert available_profiles(profiles_dir) == ["test-domain"]

    def test_lists_alphabetically(self, profiles_dir: Path) -> None:
        for name in ("zeta", "alpha"):
            data = _minimal_profile_dict()
            data["id"] = name
            (profiles_dir / f"{name}.yaml").write_text(yaml.safe_dump(data), encoding="utf-8")

        assert available_profiles(profiles_dir) == ["alpha", "test-domain", "zeta"]

    def test_ignores_non_yaml_files(self, profiles_dir: Path) -> None:
        (profiles_dir / "README.md").write_text("not a profile", encoding="utf-8")

        assert available_profiles(profiles_dir) == ["test-domain"]

    def test_returns_empty_list_for_missing_directory(self, tmp_path: Path) -> None:
        assert available_profiles(tmp_path / "nope") == []


class TestBundledProfiles:
    """The profiles shipped in the repository must always be loadable."""

    def test_every_bundled_profile_is_valid(self) -> None:
        from app.profiles.loader import DEFAULT_PROFILES_DIR

        ids = available_profiles(DEFAULT_PROFILES_DIR)
        assert ids, "expected at least one bundled profile"

        for profile_id in ids:
            profile = load_profile_by_id(profile_id)
            assert profile.id == profile_id
