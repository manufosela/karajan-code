"""Tests for splitting a research item into corpus documents.

What these pin down is the boundary. karajan-rag resolves sensitivity from the
path, so anything that leaks from the analysis half into the source half
becomes a public document without anyone editing a config. The split is a
security boundary wearing the clothes of a formatting decision.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
import yaml

from app.corpus.documents import (
    is_quarantined,
    render_analysis_document,
    render_source_document,
)
from app.models.research_item import ResearchItem


def _item(**overrides) -> ResearchItem:
    """A fully analysed item, so a test can take things away from it."""
    defaults = {
        "id": uuid.uuid4(),
        "source_id": uuid.uuid4(),
        "original_title": "Polymer creep in clear aligners",
        "abstract": "A study of force decay across two years of wear.",
        "doi": "10.1234/creep",
        "original_url": "https://example.invalid/creep",
        "journal_or_origin": "Journal of Materials",
        "publication_date": date(2026, 1, 15),
        "document_type": "paper",
        "language": "en",
        "authors": [{"name": "A. Researcher"}, {"name": "B. Colleague"}],
        "thematic_tags": ["orthodontics", "biomechanics"],
        "strategic_buckets": ["ai_digital_workflow"],
        "scientific_strength_score": Decimal("7.5"),
        "strategic_relevance_score": Decimal("8.0"),
        "hype_risk": "low",
        "time_horizon": "short_term",
        "recommended_action": "investigate",
        "confidence_level": Decimal("0.75"),
        "executive_summary_en": "Force decay is measurable and matters for fit.",
        "executive_summary_es": "La perdida de fuerza es medible y afecta al ajuste.",
        "why_it_matters_en": "It limits how long an aligner stays effective.",
        "possible_impact_en": "Shorter replacement intervals.",
        "injection_scan": {"catalogue_version": "1.0.0", "scanned_at": "x", "fields": {}},
    }
    defaults.update(overrides)
    return ResearchItem(**defaults)


def _frontmatter(document: str) -> dict:
    _, raw, _ = document.split("---", 2)
    return yaml.safe_load(raw)


class TestTheSourceDocumentCarriesOnlyWhatWasPublished:
    def test_it_has_the_title_and_the_abstract(self) -> None:
        document = render_source_document(_item())

        assert "# Polymer creep in clear aligners" in document
        assert "A study of force decay" in document

    def test_it_carries_the_identifiers_a_reader_would_want(self) -> None:
        metadata = _frontmatter(render_source_document(_item()))

        assert metadata["doi"] == "10.1234/creep"
        assert metadata["journal"] == "Journal of Materials"
        assert metadata["published"] == "2026-01-15"
        assert metadata["authors"] == ["A. Researcher", "B. Colleague"]

    @pytest.mark.parametrize(
        "term",
        ["orthodontics", "ai_digital_workflow", "investigate", "Force decay is measurable"],
        ids=["theme", "bucket", "action", "summary"],
    )
    def test_no_analysis_reaches_the_public_half(self, term: str) -> None:
        """This is the assertion that matters. The folder decides sensitivity,
        so a field that drifts into here becomes public silently."""
        assert term not in render_source_document(_item())

    def test_no_score_reaches_the_public_half(self) -> None:
        metadata = _frontmatter(render_source_document(_item()))

        assert "strategic_relevance" not in metadata
        assert "scientific_strength" not in metadata

    def test_an_item_with_no_abstract_still_produces_a_document(self) -> None:
        """Plenty of records are title and metadata only."""
        document = render_source_document(_item(abstract=None))

        assert "# Polymer creep in clear aligners" in document
        assert "## Abstract" not in document

    def test_empty_metadata_is_left_out_rather_than_written_as_null(self) -> None:
        """A frontmatter full of nulls is noise in every chunk carrying it."""
        metadata = _frontmatter(render_source_document(_item(pmid=None, arxiv_id=None)))

        assert "pmid" not in metadata
        assert "arxiv_id" not in metadata


class TestTheAnalysisDocumentCarriesTheReading:
    def test_it_has_the_summaries(self) -> None:
        document = render_analysis_document(_item())

        assert "Force decay is measurable" in document
        assert "La perdida de fuerza es medible" in document

    def test_it_carries_the_scores_as_plain_numbers(self) -> None:
        """They are Decimal in the model, and YAML should not carry that."""
        metadata = _frontmatter(render_analysis_document(_item()))

        assert metadata["strategic_relevance"] == 8.0
        assert metadata["scientific_strength"] == 7.5
        assert metadata["themes"] == ["orthodontics", "biomechanics"]

    def test_sections_with_nothing_in_them_are_skipped(self) -> None:
        document = render_analysis_document(_item(possible_impact_en=None))

        assert "## Possible impact" not in document

    def test_an_unanalysed_item_still_produces_a_readable_document(self) -> None:
        """Items ingested but not yet through the pipeline are ordinary."""
        document = render_analysis_document(
            _item(
                thematic_tags=[],
                strategic_buckets=[],
                executive_summary_en=None,
                executive_summary_es=None,
                why_it_matters_en=None,
                possible_impact_en=None,
                scientific_strength_score=None,
                strategic_relevance_score=None,
                hype_risk=None,
                time_horizon=None,
                recommended_action=None,
                confidence_level=None,
            )
        )

        assert "# Polymer creep in clear aligners" in document


class TestQuarantine:
    def test_an_item_with_findings_is_kept_out(self) -> None:
        """Everything exported is servable: karajan-rag's retrieval does not
        filter, it returns each hit with its level. So this is the only place
        the attempt can be stopped."""
        item = _item(
            injection_scan={
                "catalogue_version": "1.0.0",
                "scanned_at": "x",
                "fields": {"abstract": [{"type": "directive", "pattern": "ignore_previous"}]},
            }
        )

        assert is_quarantined(item)

    def test_a_clean_item_is_not(self) -> None:
        assert not is_quarantined(_item())

    def test_an_item_nobody_scanned_is_not_treated_as_suspect(self) -> None:
        """NULL means it predates the scan. Refusing to export the whole
        pre-scan corpus would be a sweeping change made in silence."""
        assert not is_quarantined(_item(injection_scan=None))
