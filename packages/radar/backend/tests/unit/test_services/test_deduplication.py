"""Unit tests for the deduplication service."""

from __future__ import annotations

import pytest

from app.services.deduplication import (
    DedupCandidate,
    DedupVerdict,
    ExistingItem,
    compute_content_hash,
    deduplicate,
    find_doi_duplicate,
    find_fuzzy_title_match,
)


# ---------------------------------------------------------------------------
# compute_content_hash
# ---------------------------------------------------------------------------
class TestComputeContentHash:
    """Tests for SHA-256 content hash computation."""

    def test_produces_hex_string_64_chars(self) -> None:
        result = compute_content_hash("pubmed", "12345")
        assert isinstance(result, str)
        assert len(result) == 64

    def test_deterministic(self) -> None:
        h1 = compute_content_hash("pubmed", "12345")
        h2 = compute_content_hash("pubmed", "12345")
        assert h1 == h2

    def test_different_source_different_hash(self) -> None:
        h1 = compute_content_hash("pubmed", "12345")
        h2 = compute_content_hash("crossref", "12345")
        assert h1 != h2

    def test_different_external_id_different_hash(self) -> None:
        h1 = compute_content_hash("pubmed", "12345")
        h2 = compute_content_hash("pubmed", "67890")
        assert h1 != h2

    def test_empty_strings(self) -> None:
        result = compute_content_hash("", "")
        assert isinstance(result, str)
        assert len(result) == 64

    def test_unicode_inputs(self) -> None:
        result = compute_content_hash("source_ñ", "id_café")
        assert isinstance(result, str)
        assert len(result) == 64


# ---------------------------------------------------------------------------
# find_doi_duplicate
# ---------------------------------------------------------------------------
class TestFindDoiDuplicate:
    """Tests for DOI-based cross-source deduplication."""

    def test_finds_exact_doi_match(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi="10.1000/test.1", normalized_title="title one", source_id="pubmed"),
            ExistingItem(id="item-2", content_hash="bbb", doi="10.1000/test.2", normalized_title="title two", source_id="crossref"),
        ]
        match = find_doi_duplicate("10.1000/test.1", existing)
        assert match is not None
        assert match.id == "item-1"

    def test_case_insensitive_doi_match(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi="10.1000/TEST.1", normalized_title="title", source_id="pubmed"),
        ]
        match = find_doi_duplicate("10.1000/test.1", existing)
        assert match is not None
        assert match.id == "item-1"

    def test_no_match_when_doi_absent(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi="10.1000/test.1", normalized_title="title", source_id="pubmed"),
        ]
        match = find_doi_duplicate(None, existing)
        assert match is None

    def test_no_match_when_doi_empty(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi="10.1000/test.1", normalized_title="title", source_id="pubmed"),
        ]
        match = find_doi_duplicate("", existing)
        assert match is None

    def test_no_match_when_existing_has_no_doi(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="title", source_id="pubmed"),
        ]
        match = find_doi_duplicate("10.1000/test.1", existing)
        assert match is None

    def test_no_match_when_different_doi(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi="10.1000/test.99", normalized_title="title", source_id="pubmed"),
        ]
        match = find_doi_duplicate("10.1000/test.1", existing)
        assert match is None

    def test_empty_existing_list(self) -> None:
        match = find_doi_duplicate("10.1000/test.1", [])
        assert match is None

    def test_cross_source_doi_match(self) -> None:
        """DOI match across different sources is the primary use case."""
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi="10.1000/test.1", normalized_title="title", source_id="pubmed"),
        ]
        match = find_doi_duplicate("10.1000/test.1", existing)
        assert match is not None
        assert match.source_id == "pubmed"


# ---------------------------------------------------------------------------
# find_fuzzy_title_match
# ---------------------------------------------------------------------------
class TestFindFuzzyTitleMatch:
    """Tests for fuzzy title matching using Levenshtein distance."""

    def test_exact_title_match(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="orthodontic tooth movement in adults", source_id="pubmed"),
        ]
        match, score = find_fuzzy_title_match("orthodontic tooth movement in adults", existing)
        assert match is not None
        assert match.id == "item-1"
        assert score == pytest.approx(1.0, abs=0.01)

    def test_near_match_above_threshold(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="orthodontic tooth movement in adult patients", source_id="pubmed"),
        ]
        match, score = find_fuzzy_title_match("orthodontic tooth movement in adults", existing, threshold=0.85)
        assert match is not None
        assert score >= 0.85

    def test_below_threshold_returns_none(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="clear aligner therapy outcomes", source_id="pubmed"),
        ]
        match, score = find_fuzzy_title_match("orthodontic tooth movement in adults", existing)
        assert match is None
        assert score == 0.0

    def test_empty_candidate_title(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="some title", source_id="pubmed"),
        ]
        match, score = find_fuzzy_title_match("", existing)
        assert match is None

    def test_none_candidate_title(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="some title", source_id="pubmed"),
        ]
        match, score = find_fuzzy_title_match(None, existing)
        assert match is None

    def test_empty_existing_list(self) -> None:
        match, score = find_fuzzy_title_match("orthodontic tooth movement", [])
        assert match is None

    def test_skips_items_with_empty_titles(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="", source_id="pubmed"),
            ExistingItem(id="item-2", content_hash="bbb", doi=None, normalized_title=None, source_id="crossref"),
        ]
        match, score = find_fuzzy_title_match("some title", existing)
        assert match is None

    def test_unicode_titles(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="análisis de la oclusión dental en pacientes", source_id="pubmed"),
        ]
        match, score = find_fuzzy_title_match("análisis de la oclusión dental en pacientes", existing)
        assert match is not None
        assert score == pytest.approx(1.0, abs=0.01)

    def test_best_match_selected_from_multiple(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="totally different topic about chemistry", source_id="pubmed"),
            ExistingItem(id="item-2", content_hash="bbb", doi=None, normalized_title="orthodontic tooth movement in adult patients", source_id="crossref"),
            ExistingItem(id="item-3", content_hash="ccc", doi=None, normalized_title="orthodontic tooth movement in adults a review", source_id="semantic_scholar"),
        ]
        match, score = find_fuzzy_title_match("orthodontic tooth movement in adults", existing, threshold=0.85)
        assert match is not None
        # Should pick the closest match
        assert match.id in ("item-2", "item-3")
        assert score >= 0.85

    def test_custom_threshold(self) -> None:
        existing = [
            ExistingItem(id="item-1", content_hash="aaa", doi=None, normalized_title="orthodontic tooth movement in adult patients with periodontitis", source_id="pubmed"),
        ]
        # With high threshold, should not match
        match_high, _ = find_fuzzy_title_match("orthodontic tooth movement in adults", existing, threshold=0.99)
        assert match_high is None

        # With lower threshold, should match
        match_low, score_low = find_fuzzy_title_match("orthodontic tooth movement in adults", existing, threshold=0.70)
        assert match_low is not None
        assert score_low >= 0.70


# ---------------------------------------------------------------------------
# deduplicate (orchestrator)
# ---------------------------------------------------------------------------
class TestDeduplicate:
    """Tests for the main deduplication orchestrator function."""

    def test_exact_hash_match(self) -> None:
        content_hash = compute_content_hash("pubmed", "12345")
        candidate = DedupCandidate(
            source_id="pubmed",
            external_id="12345",
            doi="10.1000/test.1",
            normalized_title="orthodontic tooth movement",
        )
        existing = [
            ExistingItem(id="item-1", content_hash=content_hash, doi="10.1000/test.1", normalized_title="orthodontic tooth movement", source_id="pubmed"),
        ]
        verdict = deduplicate(candidate, existing)
        assert verdict.verdict == "exact_duplicate"
        assert verdict.confidence == 1.0
        assert verdict.matched_item_id == "item-1"

    def test_doi_match_returns_likely_duplicate(self) -> None:
        candidate = DedupCandidate(
            source_id="crossref",
            external_id="cr-999",
            doi="10.1000/test.1",
            normalized_title="orthodontic tooth movement",
        )
        existing = [
            ExistingItem(id="item-1", content_hash="different_hash", doi="10.1000/test.1", normalized_title="orthodontic tooth movement", source_id="pubmed"),
        ]
        verdict = deduplicate(candidate, existing)
        assert verdict.verdict == "likely_duplicate"
        assert verdict.confidence == 0.95
        assert verdict.matched_item_id == "item-1"

    def test_fuzzy_title_match_returns_likely_duplicate(self) -> None:
        candidate = DedupCandidate(
            source_id="crossref",
            external_id="cr-999",
            doi=None,
            normalized_title="orthodontic tooth movement in adults a systematic review",
        )
        existing = [
            ExistingItem(id="item-1", content_hash="different_hash", doi=None, normalized_title="orthodontic tooth movement in adults: a systematic review", source_id="pubmed"),
        ]
        verdict = deduplicate(candidate, existing)
        assert verdict.verdict == "likely_duplicate"
        assert verdict.confidence >= 0.92
        assert verdict.matched_item_id == "item-1"

    def test_no_match_returns_new(self) -> None:
        candidate = DedupCandidate(
            source_id="crossref",
            external_id="cr-999",
            doi="10.1000/unique",
            normalized_title="a completely unique title about something",
        )
        existing = [
            ExistingItem(id="item-1", content_hash="different_hash", doi="10.1000/other", normalized_title="clear aligner therapy review", source_id="pubmed"),
        ]
        verdict = deduplicate(candidate, existing)
        assert verdict.verdict == "new"
        assert verdict.confidence == 1.0
        assert verdict.matched_item_id is None

    def test_empty_existing_returns_new(self) -> None:
        candidate = DedupCandidate(
            source_id="pubmed",
            external_id="12345",
            doi="10.1000/test.1",
            normalized_title="orthodontic tooth movement",
        )
        verdict = deduplicate(candidate, [])
        assert verdict.verdict == "new"
        assert verdict.confidence == 1.0
        assert verdict.matched_item_id is None

    def test_priority_exact_over_doi(self) -> None:
        """Exact hash match should take priority over DOI match."""
        content_hash = compute_content_hash("pubmed", "12345")
        candidate = DedupCandidate(
            source_id="pubmed",
            external_id="12345",
            doi="10.1000/test.1",
            normalized_title="orthodontic tooth movement",
        )
        existing = [
            ExistingItem(id="item-doi", content_hash="other_hash", doi="10.1000/test.1", normalized_title="orthodontic tooth movement", source_id="crossref"),
            ExistingItem(id="item-exact", content_hash=content_hash, doi="10.1000/other", normalized_title="different title", source_id="pubmed"),
        ]
        verdict = deduplicate(candidate, existing)
        assert verdict.verdict == "exact_duplicate"
        assert verdict.matched_item_id == "item-exact"

    def test_priority_doi_over_fuzzy(self) -> None:
        """DOI match should take priority over fuzzy title match."""
        candidate = DedupCandidate(
            source_id="crossref",
            external_id="cr-999",
            doi="10.1000/test.1",
            normalized_title="orthodontic tooth movement in adults",
        )
        existing = [
            ExistingItem(id="item-fuzzy", content_hash="hash1", doi=None, normalized_title="orthodontic tooth movement in adults", source_id="semantic_scholar"),
            ExistingItem(id="item-doi", content_hash="hash2", doi="10.1000/test.1", normalized_title="different title entirely", source_id="pubmed"),
        ]
        verdict = deduplicate(candidate, existing)
        assert verdict.verdict == "likely_duplicate"
        assert verdict.confidence == 0.95
        assert verdict.matched_item_id == "item-doi"

    def test_candidate_without_doi_or_title(self) -> None:
        candidate = DedupCandidate(
            source_id="pubmed",
            external_id="99999",
            doi=None,
            normalized_title=None,
        )
        existing = [
            ExistingItem(id="item-1", content_hash="different_hash", doi="10.1000/test.1", normalized_title="some title", source_id="crossref"),
        ]
        verdict = deduplicate(candidate, existing)
        # No hash match (different source+id), no DOI, no title → new
        assert verdict.verdict == "new"

    def test_verdict_dataclass_fields(self) -> None:
        verdict = DedupVerdict(verdict="new", confidence=1.0, matched_item_id=None)
        assert verdict.verdict == "new"
        assert verdict.confidence == 1.0
        assert verdict.matched_item_id is None

    def test_candidate_dataclass_fields(self) -> None:
        candidate = DedupCandidate(
            source_id="pubmed",
            external_id="12345",
            doi="10.1000/test.1",
            normalized_title="test title",
        )
        assert candidate.source_id == "pubmed"
        assert candidate.external_id == "12345"
        assert candidate.doi == "10.1000/test.1"
        assert candidate.normalized_title == "test title"
