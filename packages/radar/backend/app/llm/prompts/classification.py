"""Thematic classification prompt for orthodontic research items.

Provides a prompt template that instructs the LLM to classify a research
item (title + abstract) into predefined themes and extract keywords.
"""

from __future__ import annotations

VALID_THEMES: frozenset[str] = frozenset({
    "orthodontics",
    "biomechanics",
    "materials",
    "AI/digital",
    "clinical",
    "other",
})

THEMATIC_CLASSIFICATION_PROMPT = """\
You are an expert orthodontic research classifier. Given a research paper's \
title and abstract, classify it into one or more thematic categories and \
extract relevant keywords.

## Valid themes

- orthodontics: Traditional and modern orthodontic treatments, tooth movement, \
malocclusion, braces, aligners.
- biomechanics: Forces, mechanics of tooth movement, bone remodeling, \
finite element analysis, stress distribution.
- materials: Orthodontic materials, wires, brackets, adhesives, 3D printing \
materials, biocompatibility.
- AI/digital: Artificial intelligence, machine learning, digital workflows, \
CBCT, intraoral scanning, digital twins, CAD/CAM.
- clinical: Clinical trials, treatment outcomes, patient studies, \
epidemiology, case reports.
- other: Topics not fitting the above categories.

## Input

**Title:** {title}

**Abstract:** {abstract}

## Instructions

1. Assign one or more themes from the valid themes list above.
2. For each theme, provide a confidence score between 0.0 and 1.0.
3. Identify the single primary theme (highest relevance).
4. Extract 3-7 descriptive keywords from the paper.

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{{
  "themes": [
    {{"name": "<theme>", "confidence": <float 0.0-1.0>}}
  ],
  "primary_theme": "<theme>",
  "keywords": ["<keyword1>", "<keyword2>", "..."]
}}
```

Rules:
- Every theme name MUST be one of: orthodontics, biomechanics, materials, \
AI/digital, clinical, other.
- primary_theme MUST be one of the themes in the themes list.
- confidence values MUST be between 0.0 and 1.0.
- keywords MUST contain between 3 and 7 items.
- Do NOT include any text outside the JSON object.
"""


def format_classification_prompt(
    title: str,
    abstract: str | None,
) -> str:
    """Format the classification prompt with the given title and abstract.

    Args:
        title: Research paper title.
        abstract: Research paper abstract. If None or empty, replaced
                  with "No abstract available."

    Returns:
        Formatted prompt string ready to send to the LLM.
    """
    effective_abstract = abstract if abstract else "No abstract available."
    return THEMATIC_CLASSIFICATION_PROMPT.format(
        title=title,
        abstract=effective_abstract,
    )
