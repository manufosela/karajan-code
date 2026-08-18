"""An LLM that always answers correctly, so the wiring is what gets tested.

This is not a simulation of a model. It stands in for one that behaves, which
is what a smoke test needs: the question here is whether an item can travel
from a source to an analysed row in the database, not whether the analysis is
any good. Judging the analysis would need a real provider, a key and the
network -- and a test that needs the network stops running the day the network
fails, quietly.

The response is the union of what every stage validates. Each service reads
its own keys and ignores the rest, so one dictionary covers classification,
strategic bucketing, scoring, impact and summary without the double having to
guess which stage is calling it.

The values come from the unit tests of each service, so a stage that tightens
its validation breaks here too, instead of this drifting into answers no real
response would look like.
"""

from __future__ import annotations

from typing import Any

from app.llm.base import BaseLLMProvider, LLMResponse, Usage

# Themes and buckets belong to the orthodontics profile, which is the default
# ACTIVE_PROFILE. A different profile would need different values here -- the
# validators check them against the taxonomy, which is the point.
_ANSWER: dict[str, Any] = {
    # classification
    "themes": [
        {"name": "orthodontics", "confidence": 0.9},
        {"name": "biomechanics", "confidence": 0.6},
    ],
    "primary_theme": "orthodontics",
    "keywords": ["aligners", "tooth movement", "malocclusion"],
    # strategic
    "bucket": "ai_digital_workflow",
    "confidence": 0.88,
    "rationale": "Digital planning applied to treatment.",
    "time_horizon": "short_term",
    # scoring
    "scientific_strength_score": 7,
    "strategic_relevance_score": 8,
    "scientific_rationale": "Well-designed study with an adequate sample size.",
    "strategic_rationale": "Directly applicable to the manufacturing process.",
    "recommended_action": "investigate",
    "hype_risk": "low",
    # impact
    "impact_level": "significant",
    "confidence_level": 0.75,
    "impact_areas": ["aligner_manufacturing", "treatment_planning"],
    "evidence_gaps": ["No long-term clinical data"],
    # summary
    "summary_en": "The study reports a measurable improvement in treatment outcomes.",
    "summary_es": "El estudio recoge una mejora medible en los resultados del tratamiento.",
    "key_findings": ["Treatment duration reduced.", "Compliance improved."],
    "implications": ["Fewer appointments per case.", "Lower chair time per patient."],
    "why_it_matters_en": "It shortens a step that currently limits throughput.",
    "why_it_matters_es": "Acorta un paso que hoy limita la capacidad.",
    "possible_impact_en": "Fewer appointments per case.",
    "possible_impact_es": "Menos citas por caso.",
}


class FakeLLMProvider(BaseLLMProvider):
    """Answers every stage with a valid response, and counts the calls."""

    def __init__(self) -> None:
        # A pipeline that silently skipped a stage would still leave a row
        # that looks analysed, because the earlier stages filled it. The count
        # is what makes that visible.
        self.calls: list[str] = []

    async def complete(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        self.calls.append("complete")
        return LLMResponse(
            content=_ANSWER["summary_en"],
            model="fake",
            usage=Usage(prompt_tokens=0, completion_tokens=0),
            latency_ms=0.0,
        )

    async def complete_json(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        schema: dict | None = None,
    ) -> dict:
        self.calls.append("complete_json")
        return dict(_ANSWER)
