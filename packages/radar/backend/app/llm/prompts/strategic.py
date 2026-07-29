"""Strategic bucket classification prompt for orthodontic research items.

Provides a prompt template that instructs the LLM to classify a research
item (title + abstract) into a strategic bucket and assess its time horizon.
"""

from __future__ import annotations

VALID_BUCKETS: frozenset[str] = frozenset({
    "core_aligner_tech",
    "emerging_materials",
    "ai_digital_workflow",
    "biomechanics_research",
    "clinical_evidence",
    "regulatory_compliance",
    "competitive_intelligence",
})

VALID_TIME_HORIZONS: frozenset[str] = frozenset({
    "immediate",
    "short_term",
    "medium_term",
    "long_term",
})

STRATEGIC_BUCKET_PROMPT = """\
You are an expert orthodontic research strategist. Given a research paper's \
title and abstract, classify it into exactly one strategic bucket and assess \
its time horizon for industry impact.

## Strategic buckets

- core_aligner_tech: Clear aligner technology, aligner design, attachment \
protocols, staging strategies, aligner materials, direct-to-consumer aligners.
- emerging_materials: Novel orthodontic materials, shape-memory alloys, \
biocompatible polymers, smart wires, nano-materials, 3D-printable resins.
- ai_digital_workflow: Artificial intelligence, machine learning, digital \
treatment planning, CBCT analysis, intraoral scanning, digital twins, \
automated cephalometric analysis, CAD/CAM workflows.
- biomechanics_research: Tooth movement mechanics, bone remodeling, force \
systems, finite element analysis, root resorption, anchorage strategies.
- clinical_evidence: Clinical trials, treatment outcomes, systematic reviews, \
meta-analyses, comparative effectiveness, patient-reported outcomes.
- regulatory_compliance: FDA/CE regulations, medical device standards, \
clinical safety requirements, quality management, post-market surveillance.
- competitive_intelligence: Competitor products, market analysis, patent \
landscapes, industry trends, market share, business strategy.

## Time horizons

- immediate: Impact expected within 0-6 months.
- short_term: Impact expected within 6-18 months.
- medium_term: Impact expected within 18-36 months.
- long_term: Impact expected beyond 36 months.

## Input

**Title:** {title}

**Abstract:** {abstract}

## Instructions

1. Select the single most relevant strategic bucket from the list above.
2. Provide a confidence score between 0.0 and 1.0.
3. Write a brief rationale (1-3 sentences) explaining the classification.
4. Assess the time horizon for when this research could impact industry practice.

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{{{{
  "bucket": "<strategic_bucket>",
  "confidence": <float 0.0-1.0>,
  "rationale": "<brief explanation>",
  "time_horizon": "<immediate|short_term|medium_term|long_term>"
}}}}
```

Rules:
- bucket MUST be one of: core_aligner_tech, emerging_materials, \
ai_digital_workflow, biomechanics_research, clinical_evidence, \
regulatory_compliance, competitive_intelligence.
- confidence MUST be between 0.0 and 1.0.
- rationale MUST be a non-empty string of 1-3 sentences.
- time_horizon MUST be one of: immediate, short_term, medium_term, long_term.
- Do NOT include any text outside the JSON object.
"""


def format_strategic_prompt(
    title: str,
    abstract: str | None,
) -> str:
    """Format the strategic classification prompt with the given title and abstract.

    Args:
        title: Research paper title.
        abstract: Research paper abstract. If None or empty, replaced
                  with "No abstract available."

    Returns:
        Formatted prompt string ready to send to the LLM.
    """
    effective_abstract = abstract if abstract else "No abstract available."
    return STRATEGIC_BUCKET_PROMPT.format(
        title=title,
        abstract=effective_abstract,
    )
