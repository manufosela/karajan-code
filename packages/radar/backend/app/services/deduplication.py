"""Deduplication service for research items.

Provides functions to detect duplicate research items using three strategies:
1. Exact match via content_hash (SHA-256 of source_id + external_id)
2. DOI-based cross-source matching
3. Fuzzy title matching using Levenshtein distance (rapidfuzz)

Priority: exact_duplicate (hash) > DOI match > fuzzy title match.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from rapidfuzz import fuzz

from app.core.logging import get_logger

logger = get_logger(__name__)

# Default threshold for fuzzy title matching (0.0 - 1.0)
DEFAULT_FUZZY_THRESHOLD = 0.92

# Confidence scores for each match type
_CONFIDENCE_EXACT = 1.0
_CONFIDENCE_DOI = 0.95


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DedupCandidate:
    """Candidate research item to check for duplicates."""

    source_id: str
    external_id: str
    doi: str | None
    normalized_title: str | None


@dataclass(frozen=True)
class ExistingItem:
    """Existing research item to compare against."""

    id: str
    content_hash: str
    doi: str | None
    normalized_title: str | None
    source_id: str


@dataclass(frozen=True)
class DedupVerdict:
    """Result of deduplication check."""

    verdict: str  # "new", "exact_duplicate", "likely_duplicate"
    confidence: float  # 0.0 - 1.0
    matched_item_id: str | None


# ---------------------------------------------------------------------------
# Content hash computation
# ---------------------------------------------------------------------------

def compute_content_hash(source_id: str, external_id: str) -> str:
    """Compute SHA-256 hash of source_id + external_id for exact duplicate detection.

    Args:
        source_id: The source identifier (e.g. "pubmed", "crossref").
        external_id: The external identifier within the source.

    Returns:
        Hex-encoded SHA-256 hash string (64 characters).
    """
    payload = f"{source_id}:{external_id}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# DOI-based deduplication
# ---------------------------------------------------------------------------

def find_doi_duplicate(
    candidate_doi: str | None,
    existing_items: list[ExistingItem],
) -> ExistingItem | None:
    """Find an existing item with the same DOI (case-insensitive).

    Args:
        candidate_doi: DOI of the candidate item.
        existing_items: List of existing items to search.

    Returns:
        The first matching ExistingItem, or None if no match found.
    """
    if not candidate_doi:
        return None

    doi_lower = candidate_doi.lower()

    for item in existing_items:
        if item.doi and item.doi.lower() == doi_lower:
            return item

    return None


# ---------------------------------------------------------------------------
# Fuzzy title matching
# ---------------------------------------------------------------------------

def find_fuzzy_title_match(
    candidate_title: str | None,
    existing_items: list[ExistingItem],
    threshold: float = DEFAULT_FUZZY_THRESHOLD,
) -> tuple[ExistingItem | None, float]:
    """Find the best fuzzy title match among existing items.

    Uses rapidfuzz ratio (normalized Levenshtein similarity) to compare titles.

    Args:
        candidate_title: Normalized title of the candidate.
        existing_items: List of existing items to compare against.
        threshold: Minimum similarity score (0.0 - 1.0) to consider a match.

    Returns:
        Tuple of (best matching ExistingItem or None, similarity score).
        If no match meets the threshold, returns (None, 0.0).
    """
    if not candidate_title:
        return None, 0.0

    if not existing_items:
        return None, 0.0

    best_match: ExistingItem | None = None
    best_score: float = 0.0

    for item in existing_items:
        if not item.normalized_title:
            continue

        # rapidfuzz.fuzz.ratio returns 0-100, normalize to 0.0-1.0
        score = fuzz.ratio(candidate_title, item.normalized_title) / 100.0

        if score > best_score:
            best_score = score
            best_match = item

    if best_score >= threshold:
        return best_match, best_score

    return None, 0.0


# ---------------------------------------------------------------------------
# Main deduplication orchestrator
# ---------------------------------------------------------------------------

def deduplicate(
    candidate: DedupCandidate,
    existing_items: list[ExistingItem],
) -> DedupVerdict:
    """Check a candidate research item against existing items for duplicates.

    Strategy priority:
    1. Exact content_hash match → exact_duplicate (confidence=1.0)
    2. DOI match → likely_duplicate (confidence=0.95)
    3. Fuzzy title match → likely_duplicate (confidence=fuzzy score)
    4. No match → new (confidence=1.0)

    Args:
        candidate: The candidate item to check.
        existing_items: List of existing items to compare against.

    Returns:
        DedupVerdict with verdict, confidence, and matched_item_id.
    """
    if not existing_items:
        return DedupVerdict(verdict="new", confidence=1.0, matched_item_id=None)

    # 1. Exact hash match
    candidate_hash = compute_content_hash(candidate.source_id, candidate.external_id)
    for item in existing_items:
        if item.content_hash == candidate_hash:
            logger.info(
                "exact_duplicate_found",
                candidate_source=candidate.source_id,
                candidate_external_id=candidate.external_id,
                matched_item_id=item.id,
            )
            return DedupVerdict(
                verdict="exact_duplicate",
                confidence=_CONFIDENCE_EXACT,
                matched_item_id=item.id,
            )

    # 2. DOI match
    doi_match = find_doi_duplicate(candidate.doi, existing_items)
    if doi_match is not None:
        logger.info(
            "doi_duplicate_found",
            candidate_doi=candidate.doi,
            matched_item_id=doi_match.id,
            matched_source=doi_match.source_id,
        )
        return DedupVerdict(
            verdict="likely_duplicate",
            confidence=_CONFIDENCE_DOI,
            matched_item_id=doi_match.id,
        )

    # 3. Fuzzy title match
    fuzzy_match, fuzzy_score = find_fuzzy_title_match(
        candidate.normalized_title, existing_items,
    )
    if fuzzy_match is not None:
        logger.info(
            "fuzzy_title_duplicate_found",
            candidate_title=candidate.normalized_title,
            matched_item_id=fuzzy_match.id,
            fuzzy_score=fuzzy_score,
        )
        return DedupVerdict(
            verdict="likely_duplicate",
            confidence=fuzzy_score,
            matched_item_id=fuzzy_match.id,
        )

    # 4. No match
    return DedupVerdict(verdict="new", confidence=1.0, matched_item_id=None)
