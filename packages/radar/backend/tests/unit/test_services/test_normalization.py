"""Unit tests for the normalization service."""

from __future__ import annotations

from datetime import date

from app.services.normalization import (
    clean_abstract,
    detect_language,
    normalize_title,
    parse_authors,
    standardize_date,
)


# ---------------------------------------------------------------------------
# normalize_title
# ---------------------------------------------------------------------------
class TestNormalizeTitle:
    """Tests for title normalization."""

    def test_strips_html_tags(self) -> None:
        raw = "<b>Orthodontic</b> <i>tooth movement</i> in adults"
        assert normalize_title(raw) == "Orthodontic tooth movement in adults"

    def test_strips_nested_html_tags(self) -> None:
        raw = "<p><span class='x'>Clear <b>aligner</b> therapy</span></p>"
        assert normalize_title(raw) == "Clear aligner therapy"

    def test_normalizes_whitespace(self) -> None:
        raw = "  Orthodontic   tooth    movement  in   adults  "
        assert normalize_title(raw) == "Orthodontic tooth movement in adults"

    def test_normalizes_tabs_and_newlines(self) -> None:
        raw = "Orthodontic\ttooth\nmovement\r\nin adults"
        assert normalize_title(raw) == "Orthodontic tooth movement in adults"

    def test_fixes_common_html_entities(self) -> None:
        raw = "Effect of pH &lt; 7 &amp; temperature &gt; 37°C"
        assert normalize_title(raw) == "Effect of pH < 7 & temperature > 37°C"

    def test_fixes_numeric_html_entities(self) -> None:
        raw = "Caf&#233; &#x2013; orthodontics"
        assert normalize_title(raw) == "Café – orthodontics"

    def test_fixes_unicode_escape_sequences(self) -> None:
        raw = "Caf\u00e9 orthodontics"
        assert normalize_title(raw) == "Café orthodontics"

    def test_empty_string(self) -> None:
        assert normalize_title("") == ""

    def test_none_returns_empty(self) -> None:
        assert normalize_title(None) == ""  # type: ignore[arg-type]

    def test_already_clean_title(self) -> None:
        title = "A systematic review of clear aligners"
        assert normalize_title(title) == title

    def test_strips_self_closing_tags(self) -> None:
        raw = "Orthodontic<br/>tooth<br />movement"
        assert normalize_title(raw) == "Orthodontic tooth movement"

    def test_preserves_special_characters(self) -> None:
        raw = "Effect of β-tricalcium phosphate on α-SMA expression"
        assert normalize_title(raw) == "Effect of β-tricalcium phosphate on α-SMA expression"

    def test_mojibake_latin1_to_utf8(self) -> None:
        # Common mojibake: UTF-8 bytes interpreted as latin-1
        raw = "Caf\u00c3\u00a9 orthodontics"
        result = normalize_title(raw)
        assert result == "Café orthodontics"


# ---------------------------------------------------------------------------
# parse_authors
# ---------------------------------------------------------------------------
class TestParseAuthors:
    """Tests for author parsing across varied formats."""

    def test_pubmed_format(self) -> None:
        raw = [
            {"fore_name": "John", "last_name": "Smith", "affiliation": "MIT"},
        ]
        result = parse_authors(raw)
        assert len(result) == 1
        assert result[0]["name"] == "John Smith"
        assert result[0]["affiliation"] == "MIT"

    def test_crossref_format(self) -> None:
        raw = [
            {"given": "María", "family": "García", "affiliation": "UCM"},
        ]
        result = parse_authors(raw)
        assert len(result) == 1
        assert result[0]["name"] == "María García"
        assert result[0]["affiliation"] == "UCM"

    def test_semantic_scholar_format(self) -> None:
        raw = [{"name": "John Smith"}]
        result = parse_authors(raw)
        assert len(result) == 1
        assert result[0]["name"] == "John Smith"

    def test_string_single_author(self) -> None:
        raw = "Smith, John"
        result = parse_authors(raw)
        assert len(result) == 1
        assert result[0]["name"] == "John Smith"

    def test_string_multiple_authors_semicolon(self) -> None:
        raw = "Smith, John; García, María"
        result = parse_authors(raw)
        assert len(result) == 2
        assert result[0]["name"] == "John Smith"
        assert result[1]["name"] == "María García"

    def test_string_multiple_authors_and(self) -> None:
        raw = "Smith J and García M"
        result = parse_authors(raw)
        assert len(result) == 2
        assert result[0]["name"] == "Smith J"
        assert result[1]["name"] == "García M"

    def test_preserves_orcid(self) -> None:
        raw = [
            {"given": "John", "family": "Smith", "ORCID": "0000-0001-2345-6789"},
        ]
        result = parse_authors(raw)
        assert result[0].get("orcid") == "0000-0001-2345-6789"

    def test_empty_list(self) -> None:
        assert parse_authors([]) == []

    def test_empty_string(self) -> None:
        assert parse_authors("") == []

    def test_none_returns_empty(self) -> None:
        assert parse_authors(None) == []  # type: ignore[arg-type]

    def test_dict_with_only_name(self) -> None:
        raw = [{"name": "Alice Bob"}]
        result = parse_authors(raw)
        assert result[0]["name"] == "Alice Bob"
        assert result[0].get("affiliation") is None

    def test_affiliation_from_list(self) -> None:
        """Crossref sometimes sends affiliations as a list of dicts."""
        raw = [
            {"given": "John", "family": "Smith", "affiliation": [{"name": "MIT"}]},
        ]
        result = parse_authors(raw)
        assert result[0]["affiliation"] == "MIT"

    def test_mixed_formats(self) -> None:
        raw = [
            {"name": "Alice Bob"},
            {"given": "John", "family": "Smith"},
            {"fore_name": "María", "last_name": "García"},
        ]
        result = parse_authors(raw)
        assert len(result) == 3
        assert result[0]["name"] == "Alice Bob"
        assert result[1]["name"] == "John Smith"
        assert result[2]["name"] == "María García"


# ---------------------------------------------------------------------------
# standardize_date
# ---------------------------------------------------------------------------
class TestStandardizeDate:
    """Tests for date standardization to ISO 8601 date objects."""

    def test_iso_date_string(self) -> None:
        assert standardize_date("2024-06-15") == date(2024, 6, 15)

    def test_iso_datetime_string(self) -> None:
        assert standardize_date("2024-06-15T10:30:00Z") == date(2024, 6, 15)

    def test_year_month_only(self) -> None:
        assert standardize_date("2024-06") == date(2024, 6, 1)

    def test_year_only(self) -> None:
        assert standardize_date("2024") == date(2024, 1, 1)

    def test_slash_format_dmy(self) -> None:
        assert standardize_date("15/06/2024") == date(2024, 6, 15)

    def test_slash_format_mdy(self) -> None:
        # Month > 12 means it can only be day/month/year
        assert standardize_date("06/15/2024") == date(2024, 6, 15)

    def test_pubmed_date_format(self) -> None:
        """PubMed sometimes returns 'YYYY Mon DD' like '2024 Jun 15'."""
        assert standardize_date("2024 Jun 15") == date(2024, 6, 15)

    def test_long_month_name(self) -> None:
        assert standardize_date("June 15, 2024") == date(2024, 6, 15)

    def test_european_date_format(self) -> None:
        assert standardize_date("15 June 2024") == date(2024, 6, 15)

    def test_date_object_passthrough(self) -> None:
        d = date(2024, 6, 15)
        assert standardize_date(d) == d

    def test_crossref_date_parts_list(self) -> None:
        """Crossref provides dates as [year, month, day] lists."""
        assert standardize_date([2024, 6, 15]) == date(2024, 6, 15)

    def test_crossref_date_parts_year_month(self) -> None:
        assert standardize_date([2024, 6]) == date(2024, 6, 1)

    def test_crossref_date_parts_year_only(self) -> None:
        assert standardize_date([2024]) == date(2024, 1, 1)

    def test_none_returns_none(self) -> None:
        assert standardize_date(None) is None

    def test_empty_string_returns_none(self) -> None:
        assert standardize_date("") is None

    def test_invalid_string_returns_none(self) -> None:
        assert standardize_date("not a date") is None

    def test_medline_date_range(self) -> None:
        """MedlineDate like '2024 Jan-Feb' → first month."""
        assert standardize_date("2024 Jan-Feb") == date(2024, 1, 1)

    def test_datetime_object(self) -> None:
        from datetime import datetime

        dt = datetime(2024, 6, 15, 10, 30, 0)
        assert standardize_date(dt) == date(2024, 6, 15)


# ---------------------------------------------------------------------------
# clean_abstract
# ---------------------------------------------------------------------------
class TestCleanAbstract:
    """Tests for abstract cleaning."""

    def test_strips_jats_xml_tags(self) -> None:
        raw = "<jats:p>This is <jats:italic>a test</jats:italic> abstract.</jats:p>"
        assert clean_abstract(raw) == "This is a test abstract."

    def test_strips_generic_html_tags(self) -> None:
        raw = "<p>This is <b>a test</b> abstract.</p>"
        assert clean_abstract(raw) == "This is a test abstract."

    def test_joins_structured_abstract_sections(self) -> None:
        sections = {
            "BACKGROUND": "This is the background.",
            "METHODS": "We used RCT design.",
            "RESULTS": "The results showed improvement.",
            "CONCLUSIONS": "Clear aligners are effective.",
        }
        raw = "\n".join(
            f"<jats:sec><jats:title>{k}</jats:title><jats:p>{v}</jats:p></jats:sec>"
            for k, v in sections.items()
        )
        result = clean_abstract(raw)
        assert "BACKGROUND: This is the background." in result
        assert "METHODS: We used RCT design." in result
        assert "RESULTS: The results showed improvement." in result
        assert "CONCLUSIONS: Clear aligners are effective." in result

    def test_normalizes_whitespace(self) -> None:
        raw = "This   is  a   test   abstract."
        assert clean_abstract(raw) == "This is a test abstract."

    def test_empty_string(self) -> None:
        assert clean_abstract("") == ""

    def test_none_returns_empty(self) -> None:
        assert clean_abstract(None) == ""  # type: ignore[arg-type]

    def test_already_clean_abstract(self) -> None:
        text = "This is a clean abstract without any tags."
        assert clean_abstract(text) == text

    def test_strips_html_entities(self) -> None:
        raw = "Effect of pH &lt; 7 &amp; temperature"
        assert clean_abstract(raw) == "Effect of pH < 7 & temperature"

    def test_preserves_superscript_content(self) -> None:
        raw = "Ca<sup>2+</sup> concentration"
        assert clean_abstract(raw) == "Ca 2+ concentration"

    def test_mixed_jats_and_html(self) -> None:
        raw = "<jats:p>This is <b>bold</b> and <jats:italic>italic</jats:italic>.</jats:p>"
        assert clean_abstract(raw) == "This is bold and italic."


# ---------------------------------------------------------------------------
# detect_language
# ---------------------------------------------------------------------------
class TestDetectLanguage:
    """Tests for basic language detection using heuristics."""

    def test_english_text(self) -> None:
        text = (
            "This systematic review evaluates the effectiveness of clear aligners in orthodontic treatment."
        )
        assert detect_language(text) == "en"

    def test_spanish_text(self) -> None:
        text = (
            "Esta revisión sistemática evalúa la efectividad de los alineadores "
            "transparentes en el tratamiento ortodóncico."
        )
        assert detect_language(text) == "es"

    def test_short_english_text(self) -> None:
        text = "The effect of orthodontic treatment"
        assert detect_language(text) == "en"

    def test_short_spanish_text(self) -> None:
        text = "El efecto del tratamiento ortodóncico"
        assert detect_language(text) == "es"

    def test_other_language(self) -> None:
        text = (
            "Diese systematische Übersicht bewertet die Wirksamkeit von Alignern "
            "in der kieferorthopädischen Behandlung."
        )
        assert detect_language(text) == "other"

    def test_empty_string(self) -> None:
        assert detect_language("") == "other"

    def test_none_returns_other(self) -> None:
        assert detect_language(None) == "other"  # type: ignore[arg-type]

    def test_mixed_english_dominant(self) -> None:
        text = (
            "This paper studies the tratamiento of orthodontic patients in a "
            "clinical setting over several months."
        )
        assert detect_language(text) == "en"

    def test_mixed_spanish_dominant(self) -> None:
        text = (
            "Este artículo estudia el treatment de los pacientes ortodóncicos en "
            "una clínica durante varios meses."
        )
        assert detect_language(text) == "es"

    def test_french_text_is_other(self) -> None:
        text = (
            "Cette revue systématique évalue l'efficacité des aligneurs "
            "transparents dans le traitement orthodontique."
        )
        assert detect_language(text) == "other"

    def test_portuguese_text_is_other(self) -> None:
        text = "Não houve diferenças significativas nos desfechos clínicos avaliados pelo estudo randomizado."
        assert detect_language(text) == "other"
