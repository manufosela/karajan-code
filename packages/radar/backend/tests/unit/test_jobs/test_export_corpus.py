"""Tests for the corpus export job.

Most of what matters here is the destination. A job that guesses where to
write produces a corpus somewhere nobody intended and reports success, and the
mistake stays invisible until something indexes it.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.jobs.export_corpus import _destination, main


class TestWhereItWrites:
    def test_the_argument_wins(self) -> None:
        assert _destination(["prog", "/tmp/somewhere"]) == Path("/tmp/somewhere")

    def test_it_falls_back_to_the_environment(self, monkeypatch) -> None:
        monkeypatch.setenv("RADAR_CORPUS_DIR", "/tmp/from-env")

        assert _destination(["prog"]) == Path("/tmp/from-env")

    def test_a_home_relative_path_is_expanded(self, monkeypatch) -> None:
        """`~/corpus` in an env var is common and would otherwise become a
        literal directory called `~`."""
        monkeypatch.setenv("RADAR_CORPUS_DIR", "~/corpus")

        assert not str(_destination(["prog"])).startswith("~")

    def test_with_nothing_to_go_on_it_refuses(self, monkeypatch) -> None:
        """No default path. Writing a corpus somewhere nobody asked for is
        worse than refusing to write one."""
        monkeypatch.delenv("RADAR_CORPUS_DIR", raising=False)

        with pytest.raises(ValueError, match="no destination"):
            _destination(["prog"])


class TestTheJobReportsWhatHappened:
    async def test_no_destination_fails_rather_than_guessing(self, monkeypatch) -> None:
        monkeypatch.delenv("RADAR_CORPUS_DIR", raising=False)

        assert await main(["prog"]) == 1

    async def test_a_failed_export_is_a_failed_job(self, tmp_path: Path) -> None:
        """A job that swallows the error reports success while the corpus is
        stale, and the next question gets an outdated answer."""
        with (
            patch("app.jobs.export_corpus.async_session_factory"),
            patch("app.jobs.export_corpus.engine", AsyncMock()),
            patch("app.jobs.export_corpus.CorpusExporter") as exporter,
        ):
            exporter.return_value.export = AsyncMock(side_effect=OSError("disk full"))

            assert await main(["prog", str(tmp_path)]) == 1
