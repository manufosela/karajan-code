"""Normalization service for research paper data from heterogeneous sources.

Provides functions to normalize titles, parse authors, standardize dates,
clean abstracts, and detect language from varied connector outputs.
"""

from __future__ import annotations

import html
import re
from datetime import date, datetime
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Compiled regex patterns
# ---------------------------------------------------------------------------

# Matches any HTML/XML tag (including JATS namespace, self-closing)
_TAG_RE = re.compile(r"</?[a-zA-Z][a-zA-Z0-9:._-]*(?:\s[^>]*)?\s*/?>")

# Matches JATS structured section patterns:
#   <jats:sec>...<jats:title>LABEL</jats:title><jats:p>TEXT</jats:p>...</jats:sec>
_JATS_SECTION_RE = re.compile(
    r"<jats:sec[^>]*>\s*<jats:title[^>]*>(.*?)</jats:title>\s*<jats:p[^>]*>(.*?)</jats:p>\s*</jats:sec>",
    re.DOTALL,
)

# Collapse multiple whitespace
_MULTI_WS_RE = re.compile(r"\s+")

# Space before punctuation (artifact of tag stripping)
_SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([.,;:!?)])")

# Month name lookup (abbreviated and full)
_MONTH_NAMES: dict[str, int] = {}
_MONTHS_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
_MONTHS_FULL = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]
for _i, (_abbr, _full) in enumerate(zip(_MONTHS_ABBR, _MONTHS_FULL, strict=True), 1):
    _MONTH_NAMES[_abbr] = _i
    _MONTH_NAMES[_full] = _i

# Date parsing patterns
# "2024 Jun 15" or "2024 June 15"
_DATE_YMD_NAME_RE = re.compile(r"^(\d{4})\s+([A-Za-z]+)\s+(\d{1,2})$")
# "June 15, 2024" or "Jun 15, 2024"
_DATE_MDY_NAME_RE = re.compile(r"^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$")
# "15 June 2024"
_DATE_DMY_NAME_RE = re.compile(r"^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$")
# "2024 Jan-Feb" (MedlineDate range)
_DATE_MEDLINE_RANGE_RE = re.compile(r"^(\d{4})\s+([A-Za-z]+)[-/]")

# ---------------------------------------------------------------------------
# English / Spanish stop words for language detection
# ---------------------------------------------------------------------------
_EN_WORDS = frozenset(
    {
        "the",
        "of",
        "and",
        "in",
        "to",
        "a",
        "is",
        "was",
        "for",
        "that",
        "with",
        "on",
        "are",
        "as",
        "at",
        "by",
        "this",
        "an",
        "be",
        "from",
        "or",
        "which",
        "were",
        "has",
        "been",
        "have",
        "not",
        "but",
        "its",
        "can",
        "also",
        "than",
        "between",
        "study",
        "results",
        "treatment",
        "patients",
        "effect",
        "during",
        "after",
        "we",
        "our",
        "these",
        "their",
        "more",
        "when",
        "there",
        "each",
        "may",
        "clinical",
        "using",
        "used",
        "however",
        "significant",
        "compared",
    }
)

_ES_WORDS = frozenset(
    {
        "el",
        "de",
        "en",
        "los",
        "las",
        "del",
        "una",
        "con",
        "para",
        "por",
        "que",
        "se",
        "es",
        "son",
        "fue",
        "como",
        "este",
        "esta",
        "estos",
        "estas",
        "al",
        "su",
        "sus",
        "entre",
        "sobre",
        "pero",
        "más",
        "han",
        "ser",
        "ha",
        "desde",
        "hasta",
        "cada",
        "durante",
        "sin",
        "también",
        "puede",
        "tienen",
        "todos",
        "dos",
        "así",
        "donde",
        "ya",
        "muy",
        "nos",
        "hay",
        "le",
        "lo",
        "la",
        "un",
        "no",
        "sí",
        "cuando",
        "quien",
        "cual",
        "resultados",
        "pacientes",
        "tratamiento",
        "efecto",
        "clínico",
        "estudio",
        "método",
        "conclusión",
        "objetivo",
    }
)


# ---------------------------------------------------------------------------
# Title normalization
# ---------------------------------------------------------------------------


def normalize_title(title: str | None) -> str:
    """Normalize a research paper title.

    - Strips HTML/XML tags
    - Decodes HTML entities
    - Fixes common mojibake (latin-1 misinterpretation of UTF-8)
    - Normalizes whitespace
    - Strips leading/trailing whitespace

    Args:
        title: Raw title string, possibly containing HTML tags and entities.

    Returns:
        Cleaned title string. Empty string if input is None or empty.
    """
    if not title:
        return ""

    text = title

    # Fix common mojibake: latin-1 interpretation of UTF-8 bytes
    text = _fix_mojibake(text)

    # Decode HTML entities first so escaped tags become real tags
    text = html.unescape(text)

    # Strip HTML/XML tags (including any that were entity-escaped)
    text = _TAG_RE.sub(" ", text)

    # Normalize whitespace
    text = _MULTI_WS_RE.sub(" ", text).strip()

    return text


def _fix_mojibake(text: str) -> str:
    """Attempt to fix common UTF-8 mojibake from latin-1 misinterpretation."""
    try:
        # Try encoding as latin-1 and decoding as UTF-8
        candidate = text.encode("latin-1").decode("utf-8")
        # Only accept if the result is shorter (mojibake expands chars)
        if len(candidate) < len(text):
            return candidate
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    return text


# ---------------------------------------------------------------------------
# Author parsing
# ---------------------------------------------------------------------------


def parse_authors(raw: list[dict[str, Any]] | str | None) -> list[dict[str, Any]]:
    """Parse author information from varied source formats into a standard form.

    Supports:
    - PubMed format: {"fore_name": "John", "last_name": "Smith", "affiliation": "MIT"}
    - Crossref format: {"given": "John", "family": "Smith", "affiliation": "MIT" | [{"name": "MIT"}]}
    - Semantic Scholar: {"name": "John Smith"}
    - String format: "Smith, John; García, María" or "Smith J and García M"

    Returns:
        List of dicts with keys: name (str), affiliation (str|None), orcid (str|None).
    """
    if raw is None:
        return []

    if isinstance(raw, str):
        return _parse_authors_string(raw)

    if isinstance(raw, list):
        return [_normalize_author_dict(a) for a in raw if a]

    return []


def _normalize_author_dict(author: dict[str, Any]) -> dict[str, Any]:
    """Normalize a single author dict from any source format."""
    # Determine the full name
    name = author.get("name", "")

    if not name:
        # PubMed format: fore_name + last_name
        fore = author.get("fore_name", "")
        last = author.get("last_name", "")
        if fore or last:
            name = f"{fore} {last}".strip()

    if not name:
        # Crossref format: given + family
        given = author.get("given", "")
        family = author.get("family", "")
        if given or family:
            name = f"{given} {family}".strip()

    # Determine affiliation
    affiliation = _extract_affiliation(author)

    # ORCID
    orcid = author.get("ORCID") or author.get("orcid")

    result: dict[str, Any] = {"name": name}
    if affiliation:
        result["affiliation"] = affiliation
    else:
        result["affiliation"] = None
    if orcid:
        result["orcid"] = orcid

    return result


def _extract_affiliation(author: dict[str, Any]) -> str | None:
    """Extract affiliation from various formats."""
    aff = author.get("affiliation")
    if aff is None:
        return None
    if isinstance(aff, str):
        return aff if aff else None
    if isinstance(aff, list):
        # Crossref: [{"name": "MIT"}]
        names = [a.get("name", "") for a in aff if isinstance(a, dict)]
        joined = "; ".join(n for n in names if n)
        return joined if joined else None
    return None


def _parse_authors_string(raw: str) -> list[dict[str, Any]]:
    """Parse authors from a semicolon- or 'and'-delimited string."""
    if not raw.strip():
        return []

    # Split by semicolon first
    if ";" in raw:
        parts = [p.strip() for p in raw.split(";") if p.strip()]
    # Then try " and "
    elif " and " in raw.lower():
        parts = [p.strip() for p in re.split(r"\s+and\s+", raw, flags=re.IGNORECASE) if p.strip()]
    else:
        parts = [raw.strip()]

    authors: list[dict[str, Any]] = []
    for part in parts:
        name = _flip_last_first(part)
        authors.append({"name": name, "affiliation": None})

    return authors


def _flip_last_first(name: str) -> str:
    """Convert 'Last, First' to 'First Last'. Leave as-is if no comma."""
    if "," in name:
        parts = [p.strip() for p in name.split(",", 1)]
        if len(parts) == 2 and parts[1]:
            return f"{parts[1]} {parts[0]}"
    return name


# ---------------------------------------------------------------------------
# Date standardization
# ---------------------------------------------------------------------------


def standardize_date(
    date_input: str | date | datetime | list[int] | None,
) -> date | None:
    """Convert various date formats to a Python date object.

    Supports:
    - ISO 8601 strings: "2024-06-15", "2024-06-15T10:30:00Z", "2024-06", "2024"
    - Slash-separated: "15/06/2024", "06/15/2024"
    - Named months: "2024 Jun 15", "June 15, 2024", "15 June 2024"
    - MedlineDate ranges: "2024 Jan-Feb" → first month
    - date/datetime objects: passthrough / .date()
    - Crossref date-parts: [2024, 6, 15] or [2024, 6] or [2024]

    Args:
        date_input: Raw date value from any connector.

    Returns:
        date object, or None if input is None, empty, or unparseable.
    """
    if date_input is None:
        return None

    # Already a date
    if isinstance(date_input, date) and not isinstance(date_input, datetime):
        return date_input

    # datetime → date
    if isinstance(date_input, datetime):
        return date_input.date()

    # Crossref date-parts list
    if isinstance(date_input, list):
        return _parse_date_parts(date_input)

    # String
    if isinstance(date_input, str):
        text = date_input.strip()
        if not text:
            return None
        return _parse_date_string(text)

    return None


def _parse_date_parts(parts: list[int]) -> date | None:
    """Parse Crossref-style date-parts [year, month?, day?]."""
    if not parts:
        return None
    try:
        year = int(parts[0])
        month = int(parts[1]) if len(parts) > 1 else 1
        day = int(parts[2]) if len(parts) > 2 else 1
        return date(year, month, day)
    except (ValueError, TypeError, IndexError):
        return None


def _parse_date_string(text: str) -> date | None:
    """Parse a date string in various formats."""
    # ISO 8601 full date: 2024-06-15
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        try:
            return date.fromisoformat(text)
        except ValueError:
            pass

    # ISO datetime: 2024-06-15T10:30:00Z
    if "T" in text:
        try:
            # Strip timezone suffix for fromisoformat compatibility
            clean = text.replace("Z", "+00:00")
            return datetime.fromisoformat(clean).date()
        except ValueError:
            pass

    # Year-month: 2024-06
    if re.match(r"^\d{4}-\d{2}$", text):
        try:
            parts = text.split("-")
            return date(int(parts[0]), int(parts[1]), 1)
        except ValueError:
            pass

    # Year only: 2024
    if re.match(r"^\d{4}$", text):
        try:
            return date(int(text), 1, 1)
        except ValueError:
            pass

    # "2024 Jun 15" or "2024 June 15"
    m = _DATE_YMD_NAME_RE.match(text)
    if m:
        result = _build_date_from_name(int(m.group(1)), m.group(2), int(m.group(3)))
        if result:
            return result

    # "June 15, 2024" or "Jun 15, 2024"
    m = _DATE_MDY_NAME_RE.match(text)
    if m:
        result = _build_date_from_name(int(m.group(3)), m.group(1), int(m.group(2)))
        if result:
            return result

    # "15 June 2024"
    m = _DATE_DMY_NAME_RE.match(text)
    if m:
        result = _build_date_from_name(int(m.group(3)), m.group(2), int(m.group(1)))
        if result:
            return result

    # MedlineDate range: "2024 Jan-Feb"
    m = _DATE_MEDLINE_RANGE_RE.match(text)
    if m:
        month_num = _month_name_to_number(m.group(2))
        if month_num:
            try:
                return date(int(m.group(1)), month_num, 1)
            except ValueError:
                pass

    # Slash-separated: DD/MM/YYYY or MM/DD/YYYY
    if "/" in text:
        return _parse_slash_date(text)

    return None


def _build_date_from_name(year: int, month_name: str, day: int) -> date | None:
    """Build a date from year, month name, and day."""
    month_num = _month_name_to_number(month_name)
    if month_num is None:
        return None
    try:
        return date(year, month_num, day)
    except ValueError:
        return None


def _month_name_to_number(name: str) -> int | None:
    """Convert month name (abbreviated or full) to number."""
    return _MONTH_NAMES.get(name.lower())


def _parse_slash_date(text: str) -> date | None:
    """Parse slash-separated date, handling both DD/MM/YYYY and MM/DD/YYYY."""
    parts = text.split("/")
    if len(parts) != 3:
        return None
    try:
        a, b, c = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None

    # If c is a 4-digit year
    if c > 31:
        # If a > 12, it must be day → DD/MM/YYYY
        if a > 12:
            try:
                return date(c, b, a)
            except ValueError:
                return None
        # If b > 12, it must be month → MM/DD/YYYY
        if b > 12:
            try:
                return date(c, a, b)
            except ValueError:
                return None
        # Ambiguous: assume MM/DD/YYYY (US convention) but try DD/MM/YYYY too
        try:
            return date(c, a, b)
        except ValueError:
            try:
                return date(c, b, a)
            except ValueError:
                return None

    return None


# ---------------------------------------------------------------------------
# Abstract cleaning
# ---------------------------------------------------------------------------


def clean_abstract(abstract: str | None) -> str:
    """Clean a research paper abstract.

    - Parses JATS XML structured sections (Background, Methods, Results, etc.)
    - Strips remaining HTML/XML tags
    - Decodes HTML entities
    - Normalizes whitespace

    Args:
        abstract: Raw abstract text, possibly with JATS XML or HTML markup.

    Returns:
        Cleaned abstract text. Empty string if input is None or empty.
    """
    if not abstract:
        return ""

    text = abstract

    # Decode HTML entities first so escaped tags become real tags
    text = html.unescape(text)

    # Try to extract structured JATS sections
    sections = _JATS_SECTION_RE.findall(text)
    if sections:
        # Rebuild as "LABEL: text" joined by spaces
        parts = []
        for label, body in sections:
            clean_label = _TAG_RE.sub("", label).strip()
            clean_body = _TAG_RE.sub(" ", body).strip()
            clean_body = _MULTI_WS_RE.sub(" ", clean_body).strip()
            if clean_label:
                parts.append(f"{clean_label}: {clean_body}")
            else:
                parts.append(clean_body)
        text = " ".join(parts)
    else:
        # No structured sections: strip all tags
        text = _TAG_RE.sub(" ", text)

    # Normalize whitespace
    text = _MULTI_WS_RE.sub(" ", text).strip()

    # Remove spaces before punctuation (artifact of tag stripping)
    text = _SPACE_BEFORE_PUNCT_RE.sub(r"\1", text)

    return text


# ---------------------------------------------------------------------------
# Language detection
# ---------------------------------------------------------------------------


def detect_language(text: str | None) -> str:
    """Detect language of text using stop-word heuristics.

    Returns 'en' for English, 'es' for Spanish, 'other' for everything else.
    This is a lightweight heuristic — not a full NLP model.

    Args:
        text: Input text (title or abstract).

    Returns:
        Language code: 'en', 'es', or 'other'.
    """
    if not text or not text.strip():
        return "other"

    # Tokenize: lowercase, split on non-alpha
    words = re.findall(r"[a-záéíóúüñ]+", text.lower())
    if not words:
        return "other"

    total = len(words)
    en_count = sum(1 for w in words if w in _EN_WORDS)
    es_count = sum(1 for w in words if w in _ES_WORDS)

    en_ratio = en_count / total
    es_ratio = es_count / total

    # Require at least 15% stop-word match to claim a language
    threshold = 0.15

    if en_ratio >= threshold and en_ratio > es_ratio:
        return "en"
    if es_ratio >= threshold and es_ratio > en_ratio:
        return "es"

    # Fallback: check for Spanish-specific characters as a tiebreaker
    if es_ratio >= threshold:
        return "es"
    if en_ratio >= threshold:
        return "en"

    return "other"
