"""Executive summary generation prompt (bilingual EN + ES).

Provides a prompt template that instructs the LLM to generate concise
executive summaries in both English and Spanish, along with key findings
and implications for Geniova's aligner business.
"""

from __future__ import annotations

REQUIRED_SUMMARY_FIELDS: frozenset[str] = frozenset({
    "summary_en",
    "summary_es",
    "key_findings",
    "implications",
})

EXECUTIVE_SUMMARY_PROMPT = """\
You are an expert orthodontic research analyst at Geniova Technologies, a \
company specializing in clear aligner orthodontic treatments. Given a \
research paper's title, abstract, assigned themes, and evaluation scores, \
generate a concise executive summary in both English and Spanish.

## Input

**Title:** {title}

**Abstract:** {abstract}

**Themes:** {themes}

**Scores:** {scores}

## Instructions

1. Write a concise executive summary in English (summary_en). Maximum 3-4 \
sentences. Focus on what the research found and why it matters for the \
aligner industry.
2. Write the same executive summary in Spanish (summary_es). Maximum 3-4 \
sentences. This must be a proper Spanish translation, not a literal \
word-for-word translation.
3. Extract 2-4 key findings (key_findings) as short bullet-point strings. \
Each finding should be a single concise sentence.
4. Extract 2-4 strategic implications (implications) for Geniova's aligner \
business. Each implication should be a single concise sentence.

## Guidelines

- Summaries should be accessible to non-technical executives.
- Use the themes and scores to contextualize the importance of the research.
- key_findings should capture the most important scientific results.
- implications should focus on actionable business relevance for clear \
aligner manufacturing, treatment planning, or patient outcomes.
- Both summaries must convey the same information but read naturally in \
their respective language.

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{{{{
  "summary_en": "<3-4 sentence executive summary in English>",
  "summary_es": "<3-4 sentence executive summary in Spanish>",
  "key_findings": ["<finding 1>", "<finding 2>", ...],
  "implications": ["<implication 1>", "<implication 2>", ...]
}}}}
```

Rules:
- summary_en MUST be a non-empty string in English, maximum 3-4 sentences.
- summary_es MUST be a non-empty string in Spanish, maximum 3-4 sentences.
- key_findings MUST be a non-empty array of non-empty strings (2-4 items).
- implications MUST be a non-empty array of non-empty strings (2-4 items).
- Do NOT include any text outside the JSON object.
"""


def format_summary_prompt(
    title: str,
    abstract: str | None,
    themes: list[str],
    scores: dict[str, object],
) -> str:
    """Format the executive summary prompt with the given inputs.

    Args:
        title: Research paper title.
        abstract: Research paper abstract. If None or empty, replaced
                  with "No abstract available."
        themes: List of assigned theme names.
        scores: Dictionary of evaluation scores (e.g. scientific_strength_score).

    Returns:
        Formatted prompt string ready to send to the LLM.
    """
    effective_abstract = abstract if abstract else "No abstract available."
    effective_themes = ", ".join(themes) if themes else "No themes assigned"
    if scores:
        effective_scores = ", ".join(
            f"{k}: {v}" for k, v in scores.items()
        )
    else:
        effective_scores = "No scores available"
    return EXECUTIVE_SUMMARY_PROMPT.format(
        title=title,
        abstract=effective_abstract,
        themes=effective_themes,
        scores=effective_scores,
    )
