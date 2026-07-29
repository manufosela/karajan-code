"""Scientific strength and strategic relevance scoring prompt.

Provides a prompt template that instructs the LLM to evaluate a research
item (title + abstract) on two dimensions: scientific strength and
strategic relevance to Geniova's aligner business.
"""

from __future__ import annotations

VALID_RECOMMENDED_ACTIONS: frozenset[str] = frozenset({
    "monitor",
    "investigate",
    "test",
    "discard",
})

VALID_HYPE_RISKS: frozenset[str] = frozenset({
    "low",
    "medium",
    "high",
})

SCORING_PROMPT = """\
You are an expert orthodontic research analyst at Geniova Technologies, a \
company specializing in clear aligner orthodontic treatments. Given a \
research paper's title and abstract, evaluate it on two dimensions and \
provide a strategic recommendation.

## Scoring dimensions

### 1. Scientific Strength (0-10)

Evaluate the methodological rigor and scientific quality:
- **Methodology quality**: Study design (RCT > cohort > case series > opinion), \
statistical rigor, control groups, blinding.
- **Sample size**: Adequate sample for the study type and conclusions drawn.
- **Peer review**: Published in a peer-reviewed journal vs. preprint or \
conference abstract.
- **Journal impact**: Reputation and impact factor of the publication venue.

Score guide: 0-2 (weak/opinion), 3-4 (limited evidence), 5-6 (moderate), \
7-8 (strong), 9-10 (landmark/gold-standard).

### 2. Strategic Relevance (0-10)

Evaluate alignment with Geniova's clear aligner business:
- **Aligner business alignment**: Direct applicability to clear aligner \
design, manufacturing, treatment planning, or patient outcomes.
- **Market impact**: Potential to influence market dynamics, pricing, or \
demand for aligner treatments.
- **Competitive advantage**: Could provide Geniova with a technological or \
clinical edge over competitors.

Score guide: 0-2 (no relevance), 3-4 (tangential), 5-6 (moderately relevant), \
7-8 (highly relevant), 9-10 (game-changer for aligner business).

## Input

**Title:** {title}

**Abstract:** {abstract}

## Instructions

1. Assign a scientific_strength_score (integer 0-10).
2. Assign a strategic_relevance_score (integer 0-10).
3. Write a brief scientific_rationale (1-3 sentences) justifying the \
scientific strength score.
4. Write a brief strategic_rationale (1-3 sentences) justifying the \
strategic relevance score.
5. Determine the recommended_action based on the combined scores.
6. Assess the hype_risk level.

### Recommended action logic
- **monitor**: Low strategic relevance or early-stage research worth tracking.
- **investigate**: Promising findings that warrant deeper analysis.
- **test**: High-quality, highly relevant research ready for practical \
evaluation or prototyping.
- **discard**: Low scientific quality or no strategic relevance.

### Hype risk assessment
- **low**: Well-established methodology, reproducible results, conservative claims.
- **medium**: Novel approach with some validation, moderate claims.
- **high**: Extraordinary claims, small sample, unvalidated methodology, \
potential conflicts of interest.

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{{{{
  "scientific_strength_score": <integer 0-10>,
  "strategic_relevance_score": <integer 0-10>,
  "scientific_rationale": "<1-3 sentences>",
  "strategic_rationale": "<1-3 sentences>",
  "recommended_action": "<monitor|investigate|test|discard>",
  "hype_risk": "<low|medium|high>"
}}}}
```

Rules:
- scientific_strength_score MUST be an integer between 0 and 10.
- strategic_relevance_score MUST be an integer between 0 and 10.
- scientific_rationale MUST be a non-empty string.
- strategic_rationale MUST be a non-empty string.
- recommended_action MUST be one of: monitor, investigate, test, discard.
- hype_risk MUST be one of: low, medium, high.
- Do NOT include any text outside the JSON object.
"""


def format_scoring_prompt(
    title: str,
    abstract: str | None,
) -> str:
    """Format the scoring prompt with the given title and abstract.

    Args:
        title: Research paper title.
        abstract: Research paper abstract. If None or empty, replaced
                  with "No abstract available."

    Returns:
        Formatted prompt string ready to send to the LLM.
    """
    effective_abstract = abstract if abstract else "No abstract available."
    return SCORING_PROMPT.format(
        title=title,
        abstract=effective_abstract,
    )
