"""Default prompt templates, shared by every Radar Profile.

These carry no domain knowledge: every definition they present to the LLM is
rendered from the profile's own taxonomy and vocabulary. A profile only needs
its own `prompts` section when it wants to say something these do not.

Written in Mustache, so the JSON output schemas below need no brace escaping.
"""

from __future__ import annotations

from typing import Any

DEFAULT_PROMPTS: dict[str, dict[str, Any]] = {
    "classification": {
        "required_variables": [
            "analyst_role",
            "organization_name",
            "organization_description",
            "themes",
            "id",
            "description",
            "title",
            "abstract",
            "theme_ids_csv",
        ],
        "template": """\
You are {{analyst_role}} at {{organization_name}}, {{organization_description}}.
Given a research paper's title and abstract, classify it into one or more
thematic categories and extract relevant keywords.

## Valid themes

{{#themes}}
- {{id}}: {{description}}
{{/themes}}

## Input

**Title:** {{title}}

**Abstract:** {{abstract}}

## Instructions

1. Assign one or more themes from the valid themes list above.
2. For each theme, provide a confidence score between 0.0 and 1.0.
3. Identify the single primary theme (highest relevance).
4. Extract 3-7 descriptive keywords from the paper.

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{
  "themes": [
    {"name": "<theme>", "confidence": <float 0.0-1.0>}
  ],
  "primary_theme": "<theme>",
  "keywords": ["<keyword1>", "<keyword2>", "..."]
}
```

Rules:
- Every theme name MUST be one of: {{theme_ids_csv}}.
- primary_theme MUST be one of the themes in the themes list.
- confidence values MUST be between 0.0 and 1.0.
- keywords MUST contain between 3 and 7 items.
- Do NOT include any text outside the JSON object.
""",
    },
    "strategic": {
        "required_variables": [
            "analyst_role",
            "organization_name",
            "organization_description",
            "strategic_buckets",
            "time_horizons",
            "id",
            "description",
            "title",
            "abstract",
            "bucket_ids_csv",
            "time_horizon_ids_csv",
        ],
        "template": """\
You are {{analyst_role}} at {{organization_name}}, {{organization_description}}.
Given a research paper's title and abstract, classify it into exactly one
strategic bucket and assess its time horizon for industry impact.

## Strategic buckets

{{#strategic_buckets}}
- {{id}}: {{description}}
{{/strategic_buckets}}

## Time horizons

{{#time_horizons}}
- {{id}}: {{description}}
{{/time_horizons}}

## Input

**Title:** {{title}}

**Abstract:** {{abstract}}

## Instructions

1. Select the single most relevant strategic bucket from the list above.
2. Provide a confidence score between 0.0 and 1.0.
3. Write a brief rationale (1-3 sentences) explaining the classification.
4. Assess the time horizon for when this research could impact industry practice.

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{
  "bucket": "<strategic_bucket>",
  "confidence": <float 0.0-1.0>,
  "rationale": "<brief explanation>",
  "time_horizon": "<time_horizon>"
}
```

Rules:
- bucket MUST be one of: {{bucket_ids_csv}}.
- confidence MUST be between 0.0 and 1.0.
- rationale MUST be a non-empty string of 1-3 sentences.
- time_horizon MUST be one of: {{time_horizon_ids_csv}}.
- Do NOT include any text outside the JSON object.
""",
    },
    "impact": {
        "required_variables": [
            "analyst_role",
            "organization_name",
            "organization_description",
            "impact_levels",
            "hype_risks",
            "impact_recommended_actions",
            "id",
            "description",
            "title",
            "abstract",
            "impact_level_ids_csv",
            "hype_risk_ids_csv",
            "impact_action_ids_csv",
        ],
        "template": """\
You are {{analyst_role}} at {{organization_name}}, {{organization_description}}.
Given a research paper's title and abstract, perform a comprehensive impact
analysis and hype detection assessment.

## Impact level assessment

Evaluate the potential business impact of this research on the organization:

{{#impact_levels}}
- **{{id}}**: {{description}}
{{/impact_levels}}

## Hype risk detection

Assess whether the research claims are supported by solid evidence or may
be overstated:

{{#hype_risks}}
- **{{id}}**: {{description}}
{{/hype_risks}}

## Input

**Title:** {{title}}

**Abstract:** {{abstract}}

## Instructions

1. Determine the impact_level based on potential business impact.
2. Assess the hype_risk based on evidence quality vs. claim magnitude.
3. Provide a confidence_level (0.0-1.0) reflecting how certain you are in
   your assessment given the available information.
4. List specific impact_areas where this research could affect the
   organization's business.
5. Identify evidence_gaps -- what additional evidence or validation would
   strengthen or weaken the findings.
6. Recommend an action based on the combined impact and hype assessment.

### Recommended action logic

{{#impact_recommended_actions}}
- **{{id}}**: {{description}}
{{/impact_recommended_actions}}

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{
  "impact_level": "<impact_level>",
  "hype_risk": "<hype_risk>",
  "confidence_level": <float 0.0-1.0>,
  "impact_areas": ["<area1>", "<area2>"],
  "evidence_gaps": ["<gap1>", "<gap2>"],
  "recommended_action": "<recommended_action>"
}
```

Rules:
- impact_level MUST be one of: {{impact_level_ids_csv}}.
- hype_risk MUST be one of: {{hype_risk_ids_csv}}.
- confidence_level MUST be a float between 0.0 and 1.0.
- impact_areas MUST be a list of strings (may be empty if no areas apply).
- evidence_gaps MUST be a list of strings (may be empty if no gaps found).
- recommended_action MUST be one of: {{impact_action_ids_csv}}.
- Do NOT include any text outside the JSON object.
""",
    },
    "scoring": {
        "required_variables": [
            "analyst_role",
            "organization_name",
            "organization_description",
            "hype_risks",
            "scoring_recommended_actions",
            "id",
            "description",
            "title",
            "abstract",
            "hype_risk_ids_csv",
            "scoring_action_ids_csv",
        ],
        "template": """\
You are {{analyst_role}} at {{organization_name}}, {{organization_description}}.
Given a research paper's title and abstract, evaluate it on two independent
dimensions: scientific strength and strategic relevance.

## Scientific strength (1-10)

Judge methodology, sample size, controls, reproducibility, peer review
status and journal standing. A score of 1 means anecdotal or unsupported;
10 means rigorous, well-powered and independently validated.

## Strategic relevance (1-10)

Judge how directly the findings bear on the organization's business. A
score of 1 means no discernible connection; 10 means it affects a core
product, process or market position right now.

## Hype risk

{{#hype_risks}}
- **{{id}}**: {{description}}
{{/hype_risks}}

## Recommended action

{{#scoring_recommended_actions}}
- **{{id}}**: {{description}}
{{/scoring_recommended_actions}}

## Input

**Title:** {{title}}

**Abstract:** {{abstract}}

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{
  "scientific_strength_score": <int 1-10>,
  "strategic_relevance_score": <int 1-10>,
  "scientific_rationale": "<brief explanation>",
  "strategic_rationale": "<brief explanation>",
  "recommended_action": "<recommended_action>",
  "hype_risk": "<hype_risk>"
}
```

Rules:
- Both scores MUST be integers between 1 and 10.
- Both rationales MUST be non-empty strings.
- recommended_action MUST be one of: {{scoring_action_ids_csv}}.
- hype_risk MUST be one of: {{hype_risk_ids_csv}}.
- Do NOT include any text outside the JSON object.
""",
    },
    "summary": {
        "required_variables": [
            "analyst_role",
            "organization_name",
            "organization_description",
            "title",
            "abstract",
            "assigned_themes",
            "scientific_strength_score",
            "strategic_relevance_score",
            "summary_language_codes_csv",
        ],
        "template": """\
You are {{analyst_role}} at {{organization_name}}, {{organization_description}}.
Given a research paper's title, abstract, assigned themes and evaluation
scores, write a concise executive summary for a strategic audience.

## Input

**Title:** {{title}}

**Abstract:** {{abstract}}

**Assigned themes:** {{assigned_themes}}

**Scientific strength:** {{scientific_strength_score}}/10

**Strategic relevance:** {{strategic_relevance_score}}/10

## Instructions

1. Write one executive summary per required language, 2-4 sentences each,
   aimed at a decision maker who will not read the paper.
2. Extract the key findings as short, factual bullet points.
3. State the implications for the organization concretely -- what it
   changes, confirms or threatens.

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{
  "summary_en": "<executive summary in English>",
  "summary_es": "<executive summary in Spanish>",
  "key_findings": ["<finding1>", "<finding2>"],
  "implications": "<what this means for the organization>"
}
```

Rules:
- One summary field per language code in: {{summary_language_codes_csv}}.
- key_findings MUST be a non-empty list of strings.
- implications MUST be a non-empty string.
- Do NOT include any text outside the JSON object.
""",
    },
    "distillation": {
        "required_variables": [
            "analyst_role",
            "organization_name",
            "organization_description",
            "title",
            "abstract",
            "source_reference",
        ],
        "template": """\
You are {{analyst_role}} at {{organization_name}}, {{organization_description}}.

Turn the document below into a distilled card: something another practitioner
can decide from without reading the original. A card is only worth writing
when the document teaches a reusable lesson -- a technique, a pattern, a
result that changes how someone would act. Reporting that a document does not
carry one is a correct and useful answer.

## Input

**Title:** {{title}}

**Abstract:** {{abstract}}

**Source:** {{source_reference}}

## What a card contains

- **Problem signature**: how someone recognises they have this problem,
  described from the symptoms rather than the solution.
- **Reach for it when**: the conditions under which this genuinely applies.
- **Do NOT reach for it when**: the conditions under which it is the wrong
  answer, including the cheaper or simpler thing that beats it there.
- **Trade-offs**: what adopting it costs -- complexity, operational burden,
  what problem it leaves unsolved.
- **Canonical source**: the work this comes from, precisely enough to find it.

## Instructions

1. Write each section from what the document actually supports. Do not
   generalise beyond it and do not import knowledge it does not contain.
2. The limits matter most. A card without real boundaries is worse than no
   card, because a reader cannot tell "this always applies" from "nobody
   checked". If the document does not let you state when this is the wrong
   answer, say so instead of inventing a plausible limit.
3. Set distillable to false when the document teaches nothing reusable, when
   it is an announcement or a summary rather than a finding, or when its
   limits cannot be established. Give the reason plainly.

## Output format

Respond ONLY with valid JSON matching this schema:

```json
{
  "distillable": <true|false>,
  "reason": "<why it cannot be distilled, or null when it can>",
  "card": {
    "title": "<what this is, as a practitioner would name it>",
    "problem_signature": "<the symptoms>",
    "reach_for_it_when": "<the conditions>",
    "do_not_reach_for_it_when": "<the counter-conditions>",
    "trade_offs": "<what it costs>",
    "canonical_source": "<the work it comes from>"
  }
}
```

Rules:
- When distillable is false, card MUST be null and reason MUST explain why.
- When distillable is true, reason MUST be null and every card section MUST
  be present and non-empty.
- Never write "N/A", "none", "not applicable" or similar in a section. A
  section you cannot fill means distillable is false.
- Do NOT include any text outside the JSON object.
""",
    },
}
