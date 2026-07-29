"""Tests for Mustache prompt rendering driven by a Radar Profile."""

from __future__ import annotations

import pytest

from app.profiles.loader import load_profile_by_id
from app.profiles.renderer import (
    MissingVariableError,
    PromptRenderer,
    RenderError,
    render_template,
)
from app.profiles.schema import RadarProfile

from .test_schema import _minimal_profile_dict


@pytest.fixture
def profile() -> RadarProfile:
    return RadarProfile.model_validate(_minimal_profile_dict())


@pytest.fixture
def renderer(profile: RadarProfile) -> PromptRenderer:
    return PromptRenderer(profile)


# ---------------------------------------------------------------------------
# The template engine itself
# ---------------------------------------------------------------------------

class TestRenderTemplate:
    def test_substitutes_a_simple_variable(self) -> None:
        assert render_template("Hello {{name}}.", {"name": "world"}) == "Hello world."

    def test_substitutes_repeated_variables(self) -> None:
        result = render_template("{{a}}-{{a}}", {"a": "x"})

        assert result == "x-x"

    def test_tolerates_whitespace_inside_tags(self) -> None:
        assert render_template("{{  name  }}", {"name": "ok"}) == "ok"

    def test_raises_for_an_unknown_variable(self) -> None:
        """Silently rendering an empty string would corrupt a prompt unnoticed."""
        with pytest.raises(MissingVariableError, match="name"):
            render_template("Hello {{name}}.", {})

    def test_renders_non_string_values(self) -> None:
        assert render_template("{{n}}/10", {"n": 7}) == "7/10"

    def test_leaves_json_braces_untouched(self) -> None:
        template = 'Return {"bucket": "<id>"} for {{title}}.'

        result = render_template(template, {"title": "T"})

        assert result == 'Return {"bucket": "<id>"} for T.'

    def test_does_not_html_escape(self) -> None:
        """Prompts are plain text for an LLM, not HTML."""
        result = render_template("{{q}}", {"q": 'a & b < c "d"'})

        assert result == 'a & b < c "d"'


class TestSections:
    def test_iterates_over_a_list_of_mappings(self) -> None:
        template = "{{#items}}\n- {{id}}: {{label}}\n{{/items}}"
        context = {
            "items": [
                {"id": "a", "label": "Alpha"},
                {"id": "b", "label": "Beta"},
            ]
        }

        assert render_template(template, context) == "- a: Alpha\n- b: Beta\n"

    def test_renders_nothing_for_an_empty_list(self) -> None:
        template = "before\n{{#items}}\n- {{id}}\n{{/items}}after"

        assert render_template(template, {"items": []}) == "before\nafter"

    def test_inner_scope_falls_back_to_the_outer_context(self) -> None:
        template = "{{#items}}{{prefix}}{{id}} {{/items}}"
        context = {"prefix": ">", "items": [{"id": "a"}, {"id": "b"}]}

        assert render_template(template, context) == ">a >b "

    def test_supports_a_list_of_scalars(self) -> None:
        template = "{{#tags}}[{{.}}]{{/tags}}"

        assert render_template(template, {"tags": ["x", "y"]}) == "[x][y]"

    def test_inverted_section_renders_when_value_is_falsy(self) -> None:
        template = "{{^items}}nothing found{{/items}}"

        assert render_template(template, {"items": []}) == "nothing found"

    def test_inverted_section_is_skipped_when_value_is_truthy(self) -> None:
        template = "{{^items}}nothing{{/items}}"

        assert render_template(template, {"items": [{"id": "a"}]}) == ""

    def test_supports_two_sibling_sections(self) -> None:
        template = "{{#a}}{{id}}{{/a}}|{{#b}}{{id}}{{/b}}"
        context = {"a": [{"id": "1"}], "b": [{"id": "2"}]}

        assert render_template(template, context) == "1|2"

    def test_raises_for_an_unclosed_section(self) -> None:
        with pytest.raises(RenderError, match="unclosed section"):
            render_template("{{#items}}oops", {"items": []})

    def test_raises_for_an_unknown_section(self) -> None:
        with pytest.raises(MissingVariableError, match="items"):
            render_template("{{#items}}x{{/items}}", {})


# ---------------------------------------------------------------------------
# Profile-driven rendering
# ---------------------------------------------------------------------------

class TestPromptRendererContext:
    def test_exposes_organization_fields(self, renderer: PromptRenderer) -> None:
        context = renderer.base_context()

        assert context["organization_name"] == "Acme Corp"
        assert context["analyst_role"] == "expert widget research analyst"
        assert context["organization_description"] == "a company specializing in widgets"

    def test_exposes_taxonomy_as_lists_of_mappings(self, renderer: PromptRenderer) -> None:
        context = renderer.base_context()

        assert context["themes"][0]["id"] == "alpha"
        assert context["themes"][0]["description"] == "Alpha topics."

    def test_exposes_csv_id_lists_in_declaration_order(
        self, renderer: PromptRenderer
    ) -> None:
        """Rules read 'MUST be one of: ...', so the order must be stable."""
        context = renderer.base_context()

        assert context["theme_ids_csv"] == "alpha, beta"
        assert context["time_horizon_ids_csv"] == "immediate, long_term"

    def test_exposes_vocabulary_csv_lists(self, renderer: PromptRenderer) -> None:
        context = renderer.base_context()

        assert context["impact_level_ids_csv"] == "transformative, minimal"
        assert context["impact_action_ids_csv"] == "monitor, archive"
        assert context["scoring_action_ids_csv"] == "monitor, discard"

    def test_exposes_summary_language_codes(self, renderer: PromptRenderer) -> None:
        assert renderer.base_context()["summary_language_codes_csv"] == "en, es"


class TestPromptRendererRendering:
    def test_renders_a_named_prompt(self, renderer: PromptRenderer) -> None:
        result = renderer.render("classification", title="T", abstract="A")

        assert result == "Classify T with A."

    def test_raises_for_an_unknown_prompt_name(self, renderer: PromptRenderer) -> None:
        with pytest.raises(KeyError, match="nonexistent"):
            renderer.render("nonexistent", title="T")

    def test_raises_when_a_required_variable_is_not_supplied(
        self, renderer: PromptRenderer
    ) -> None:
        with pytest.raises(MissingVariableError, match="abstract"):
            renderer.render("classification", title="T")

    def test_call_variables_override_the_base_context(
        self, renderer: PromptRenderer
    ) -> None:
        result = renderer.render(
            "classification", title="{{not-a-tag}}", abstract="A"
        )

        assert "{{not-a-tag}}" in result

    def test_substituted_values_are_not_re_rendered(
        self, renderer: PromptRenderer
    ) -> None:
        """A paper title containing braces must not be interpreted as a tag."""
        result = renderer.render("classification", title="{{abstract}}", abstract="A")

        assert result == "Classify {{abstract}} with A."


# ---------------------------------------------------------------------------
# The bundled profile must render end to end
# ---------------------------------------------------------------------------

class TestBundledOrthodonticsPrompts:
    @pytest.fixture(scope="class")
    def ortho_renderer(self) -> PromptRenderer:
        return PromptRenderer(load_profile_by_id("orthodontics"))

    def test_classification_prompt_lists_every_theme(
        self, ortho_renderer: PromptRenderer
    ) -> None:
        prompt = ortho_renderer.render(
            "classification", title="A study", abstract="An abstract"
        )

        for theme_id in ("orthodontics", "biomechanics", "materials", "AI/digital"):
            assert theme_id in prompt
        assert "A study" in prompt

    def test_strategic_prompt_lists_buckets_and_horizons(
        self, ortho_renderer: PromptRenderer
    ) -> None:
        prompt = ortho_renderer.render("strategic", title="T", abstract="A")

        assert "core_aligner_tech" in prompt
        assert "competitive_intelligence" in prompt
        assert "medium_term" in prompt

    def test_impact_prompt_lists_levels_and_actions(
        self, ortho_renderer: PromptRenderer
    ) -> None:
        prompt = ortho_renderer.render("impact", title="T", abstract="A")

        assert "transformative" in prompt
        assert "act_now" in prompt

    def test_scoring_prompt_uses_its_own_action_vocabulary(
        self, ortho_renderer: PromptRenderer
    ) -> None:
        prompt = ortho_renderer.render("scoring", title="T", abstract="A")

        assert "discard" in prompt
        assert "act_now" not in prompt

    def test_summary_prompt_includes_scores(self, ortho_renderer: PromptRenderer) -> None:
        prompt = ortho_renderer.render(
            "summary",
            title="T",
            abstract="A",
            assigned_themes="orthodontics, materials",
            scientific_strength_score=8,
            strategic_relevance_score=6,
        )

        assert "8/10" in prompt
        assert "orthodontics, materials" in prompt

    def test_every_bundled_prompt_renders_without_leftover_tags(
        self, ortho_renderer: PromptRenderer
    ) -> None:
        """No {{...}} may survive rendering, or the LLM sees raw template syntax."""
        common = {"title": "T", "abstract": "A"}
        extra = {
            "summary": {
                "assigned_themes": "orthodontics",
                "scientific_strength_score": 5,
                "strategic_relevance_score": 5,
            }
        }

        for name in ("classification", "strategic", "impact", "scoring", "summary"):
            prompt = ortho_renderer.render(name, **common, **extra.get(name, {}))

            assert "{{" not in prompt, f"unrendered tag left in {name} prompt"
