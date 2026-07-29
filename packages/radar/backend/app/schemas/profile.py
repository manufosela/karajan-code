"""Read-only API representation of the active Radar Profile.

The frontend needs the domain vocabulary to label anything it shows: theme
names, strategic buckets, time horizons. Serving them from here is what keeps
those lists out of the components.
"""

from pydantic import BaseModel

from app.profiles.schema import RadarProfile


class TermResponse(BaseModel):
    """A single entry of a controlled vocabulary."""

    id: str
    label: str
    description: str


class TaxonomyResponse(BaseModel):
    """The classification vocabulary of the active domain."""

    themes: list[TermResponse]
    strategic_buckets: list[TermResponse]
    time_horizons: list[TermResponse]
    keywords: list[str]


class VocabularyResponse(BaseModel):
    """The closed value sets the analysis pipeline scores against."""

    impact_levels: list[TermResponse]
    hype_risks: list[TermResponse]
    impact_recommended_actions: list[TermResponse]
    scoring_recommended_actions: list[TermResponse]


class BrandingResponse(BaseModel):
    """User-facing naming for this radar instance."""

    app_name: str
    short_name: str
    tagline: str
    organization_name: str


class ActiveProfileResponse(BaseModel):
    """Everything the frontend needs to describe the domain it is showing."""

    id: str
    name: str
    version: str
    locale: str
    branding: BrandingResponse
    taxonomy: TaxonomyResponse
    vocabulary: VocabularyResponse

    @classmethod
    def from_profile(cls, profile: RadarProfile) -> "ActiveProfileResponse":
        """Project a loaded profile onto its API representation.

        Deliberately partial: prompts, source queries and LLM settings are
        operational configuration and never reach the browser.
        """
        return cls(
            id=profile.id,
            name=profile.name,
            version=profile.version,
            locale=profile.locale,
            branding=BrandingResponse(
                app_name=profile.branding.app_name,
                short_name=profile.branding.short_name,
                tagline=profile.branding.tagline,
                organization_name=profile.organization.name,
            ),
            taxonomy=TaxonomyResponse(
                themes=_terms(profile.taxonomy.themes),
                strategic_buckets=_terms(profile.taxonomy.strategic_buckets),
                time_horizons=_terms(profile.taxonomy.time_horizons),
                keywords=list(profile.taxonomy.keywords),
            ),
            vocabulary=VocabularyResponse(
                impact_levels=_terms(profile.vocabulary.impact_levels),
                hype_risks=_terms(profile.vocabulary.hype_risks),
                impact_recommended_actions=_terms(profile.vocabulary.impact_recommended_actions),
                scoring_recommended_actions=_terms(profile.vocabulary.scoring_recommended_actions),
            ),
        )


def _terms(entries: list) -> list[TermResponse]:
    """Map profile term definitions onto their response shape."""
    return [TermResponse(id=entry.id, label=entry.label, description=entry.description) for entry in entries]
