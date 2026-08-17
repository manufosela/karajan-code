"""Turning a research item into the documents a corpus is made of.

One row becomes two documents, and that split is the whole point. What a
source published -- title, abstract, authors, identifiers -- was already
public before this radar read it. What the radar concluded about it --
themes, strategic bucket, scores, executive summary -- is the organisation's
reading of that material, and it is not.

karajan-rag decides sensitivity by **path**, not by content: the indexer
resolves it with ``sensitivityFor(relPath)`` from ``easy.sensitivity`` plus
prefix rules, and the frontmatter is not read. So which folder a document
lands in is not a filing convention, it is the mechanism that keeps the
analysis away from a public LLM. Splitting the row is what makes the two
halves placeable at all.

The documents are markdown with YAML frontmatter, the same shape the distilled
cards use. The engine ignores that frontmatter for sensitivity, but it
survives chunking and gives whoever reads a hit somewhere to find the DOI.
"""

from __future__ import annotations

from typing import Any

import yaml

from app.models.research_item import ResearchItem

_FENCE = "---"


def is_quarantined(item: ResearchItem) -> bool:
    """Whether this item must stay out of the consultable corpus.

    An item that tripped the injection scan does not belong in a corpus that
    feeds agents. karajan-rag's retrieval does not filter -- ``POST /query``
    returns every hit with its sensitivity level, and the gate only governs
    the LLM path -- so **everything exported is servable**. A document saying
    "ignore all previous instructions" would reach an agent as trusted
    context, which is precisely the consumer KRD-TSK-0004 set out to protect.

    Filtering at the source is strictly stronger than filtering at serve time.
    An item with no scan record at all (ingested before the scan existed) is
    not treated as suspect: unknown is not the same as flagged, and refusing
    to export the entire pre-scan corpus would be a sweeping change made in
    silence.
    """
    scan = item.injection_scan
    return bool(scan and scan.get("fields"))


def render_source_document(item: ResearchItem) -> str:
    """What the source published, as a document.

    Public because it already was: this is the abstract as its publisher put
    it out, not anything this radar worked out.
    """
    metadata = _prune(
        {
            "doi": item.doi,
            "pmid": item.pmid,
            "arxiv_id": item.arxiv_id,
            "nct_id": item.nct_id,
            "url": item.original_url,
            "journal": item.journal_or_origin,
            "published": item.publication_date.isoformat() if item.publication_date else None,
            "language": item.language,
            "document_type": item.document_type,
            "authors": [_author_name(a) for a in item.authors or []] or None,
        }
    )

    body = [f"# {item.original_title}\n"]
    if item.abstract:
        body.append(f"\n## Abstract\n\n{item.abstract}\n")

    return _with_frontmatter(metadata, "".join(body))


def render_analysis_document(item: ResearchItem) -> str:
    """What this radar concluded about it.

    Internal by default. Themes and buckets are the active profile's taxonomy
    applied to someone else's paper, and the summaries say why it matters *to
    this organisation* -- which is a statement about the organisation, not
    about the paper.
    """
    metadata = _prune(
        {
            "doi": item.doi,
            "themes": list(item.thematic_tags or []) or None,
            "strategic_buckets": list(item.strategic_buckets or []) or None,
            "scientific_strength": _number(item.scientific_strength_score),
            "strategic_relevance": _number(item.strategic_relevance_score),
            "hype_risk": item.hype_risk,
            "time_horizon": item.time_horizon,
            "recommended_action": item.recommended_action,
            "confidence": _number(item.confidence_level),
        }
    )

    sections = [
        ("Executive summary", item.executive_summary_en),
        ("Resumen ejecutivo", item.executive_summary_es),
        ("Why it matters", item.why_it_matters_en),
        ("Por qué importa", item.why_it_matters_es),
        ("Possible impact", item.possible_impact_en),
        ("Impacto posible", item.possible_impact_es),
    ]

    body = [f"# {item.original_title}\n"]
    body.extend(f"\n## {heading}\n\n{text}\n" for heading, text in sections if text)

    return _with_frontmatter(metadata, "".join(body))


def _with_frontmatter(metadata: dict[str, Any], body: str) -> str:
    """Put the metadata in YAML frontmatter above the document."""
    frontmatter = yaml.safe_dump(
        metadata,
        default_flow_style=False,
        sort_keys=True,
        allow_unicode=True,
    )
    return f"{_FENCE}\n{frontmatter}{_FENCE}\n{body}"


def _prune(metadata: dict[str, Any]) -> dict[str, Any]:
    """Drop the keys with nothing in them.

    A frontmatter full of nulls is noise in every chunk that carries it, and
    an absent key already says the same thing.
    """
    return {key: value for key, value in metadata.items() if value is not None}


def _author_name(author: Any) -> str:
    """Author entries arrive as dicts from the connectors, shape not fixed."""
    if isinstance(author, dict):
        return str(author.get("name") or author.get("family") or author)
    return str(author)


def _number(value: Any) -> float | None:
    """Scores are Decimal in the model; YAML should not carry that."""
    return float(value) if value is not None else None
