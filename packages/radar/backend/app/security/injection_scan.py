"""Scanning ingested documents for prompt-injection attempts.

This radar reads documents written by strangers and puts them into an LLM
prompt. That is the whole job, and it is also the exposure: a feed that has
been tampered with can carry text aimed not at the reader but at the model,
and by the time it reaches the pipeline it is indistinguishable from an
abstract. The containment belongs here, at the point where third-party
content enters, rather than in whatever consumes the corpus later.

**This is pattern detection, not a guarantee.** It catches the clumsy and
the accidental: a document that says "ignore all previous instructions", one
that opens a fake instruction block mid-abstract, a run of characters a
reader cannot see, a comment block far too large to be a comment. Someone
who knows what is in the catalogue can rephrase around it. Treating a clean
scan as proof of safety would be worse than not scanning at all, because it
invites exactly the confidence the scan cannot support.

The catalogue lives beside this file as data (``injection_patterns.json``),
copied from karajan-code, which holds the family's knowledge of what an
attempt looks like. The output contract matches ``scanForInjection`` there,
so the two can share a catalogue later without their callers noticing.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

_CATALOGUE = Path(__file__).with_name("injection_patterns.json")

# How much of the offending text to keep. Enough to recognise the attempt,
# short enough that a finding cannot itself become a payload when it is read
# back by a person or written into a log.
_SNIPPET_CHARS = 120


@dataclass(frozen=True)
class Finding:
    """One reason a document looks like an injection attempt."""

    type: str
    pattern: str
    snippet: str
    line: int


@dataclass(frozen=True)
class ScanResult:
    """The verdict on one piece of text.

    ``clean`` means nothing in the catalogue matched. It does not mean the
    text is safe -- see the module docstring.
    """

    clean: bool
    findings: tuple[Finding, ...]
    summary: str


def scan(text: str | None) -> ScanResult:
    """Scan one piece of text for injection patterns.

    Args:
        text: The content to scan. None and empty are treated as nothing to
            scan rather than as an error, because a document with no
            abstract is ordinary.

    Returns:
        The findings, in catalogue order.
    """
    if not text:
        return ScanResult(clean=True, findings=(), summary="Nothing to scan")

    catalogue = _load_catalogue()
    findings = _match_patterns(text, catalogue["directive"], kind="directive")
    findings.extend(_match_patterns(text, catalogue["unicode"], kind="unicode"))
    findings.extend(_oversized_comments(text, catalogue["comment_block"]))

    return ScanResult(
        clean=not findings,
        findings=tuple(findings),
        summary=_summarise(findings),
    )


def scan_fields(**fields: str | None) -> dict[str, ScanResult]:
    """Scan several named fields, keeping only the ones with findings.

    Every field that travels into a prompt is scanned, not just the body: a
    title reaches the model exactly like an abstract does, and is a quieter
    place to hide something because it is short enough to look harmless.

    Args:
        **fields: Field name to content.

    Returns:
        Field name to result, for the fields that turned something up. A
        clean document yields an empty mapping, so a caller can treat the
        result as the list of problems rather than having to filter it.
    """
    results = {name: scan(value) for name, value in fields.items()}
    return {name: result for name, result in results.items() if not result.clean}


def scan_record(*, scanned_at: datetime, **fields: str | None) -> dict[str, Any]:
    """Scan named fields and return the record to store alongside the item.

    Storing the record even when nothing is found is the point: an absent
    record means nobody looked, and a record with no findings means somebody
    looked and the document was clean. Collapsing the two would make an
    unscanned corpus indistinguishable from a safe one.

    The catalogue version travels with the record, because a finding only
    means something relative to the patterns that were in force when it was
    made -- and a clean result even more so.

    Args:
        scanned_at: When the scan ran. Passed in rather than read from the
            clock so the caller stamps the whole item consistently.
        **fields: Field name to content.

    Returns:
        A JSON-serialisable record: the catalogue version, the timestamp, and
        the findings per field. Fields that came out clean are not listed.
    """
    found = scan_fields(**fields)

    return {
        "catalogue_version": _load_catalogue()["version"],
        "scanned_at": scanned_at.isoformat(),
        "fields": {name: [asdict(finding) for finding in result.findings] for name, result in found.items()},
    }


@lru_cache(maxsize=1)
def _load_catalogue() -> dict[str, Any]:
    """Read and compile the catalogue once.

    Every ingested item is scanned across several fields, so compiling the
    patterns per call would put a regex compiler in the hot path of every
    run.

    Raises:
        ValueError: If a pattern in the catalogue is not a usable regex.
    """
    raw = json.loads(_CATALOGUE.read_text(encoding="utf-8"))

    return {
        "version": raw["version"],
        "directive": _compile_all(raw["directive"]),
        "unicode": _compile_all(raw["unicode"]),
        "comment_block": {
            "max_chars": raw["comment_block"]["max_chars"],
            "delimiters": _compile_all(raw["comment_block"]["delimiters"]),
        },
    }


def _compile_all(entries: list[dict[str, str]]) -> tuple[tuple[str, re.Pattern[str]], ...]:
    """Compile catalogue entries, naming the one at fault if any fails.

    Raises:
        ValueError: If an entry does not compile. The catalogue is data, so
            a bad edit is a data error and should say which entry.
    """
    compiled = []
    for entry in entries:
        try:
            compiled.append((entry["id"], re.compile(entry["regex"], re.IGNORECASE)))
        except re.error as exc:
            raise ValueError(f"injection pattern '{entry['id']}' is not a valid regex: {exc}") from exc
    return tuple(compiled)


def _match_patterns(
    text: str,
    patterns: tuple[tuple[str, re.Pattern[str]], ...],
    *,
    kind: str,
) -> list[Finding]:
    """Report the first match of each pattern.

    One finding per pattern rather than per occurrence: repeating the same
    match twenty times says nothing the first one did not.
    """
    findings = []
    for name, pattern in patterns:
        match = pattern.search(text)
        if match:
            findings.append(
                Finding(
                    type=kind,
                    pattern=name,
                    snippet=_excerpt(text, match.start()),
                    line=_line_at(text, match.start()),
                )
            )
    return findings


def _oversized_comments(text: str, config: dict[str, Any]) -> list[Finding]:
    """Report comment blocks too large to be comments.

    The size is the signal, not the content: readers skim comments and models
    do not, which makes an oversized one a comfortable place to park a
    payload.
    """
    limit = config["max_chars"]
    findings = []

    for name, pattern in config["delimiters"]:
        for match in pattern.finditer(text):
            if len(match.group(0)) > limit:
                findings.append(
                    Finding(
                        type="comment_block",
                        pattern=f"{name}: {len(match.group(0))} chars (max {limit})",
                        snippet=_excerpt(text, match.start()),
                        line=_line_at(text, match.start()),
                    )
                )
    return findings


def _excerpt(text: str, at: int) -> str:
    """Take a short, single-line excerpt around a match."""
    start = max(0, at - _SNIPPET_CHARS // 4)
    return " ".join(text[start : start + _SNIPPET_CHARS].split())


def _line_at(text: str, at: int) -> int:
    """The 1-based line the offset falls on."""
    return text.count("\n", 0, at) + 1


def _summarise(findings: list[Finding]) -> str:
    """One line a human can act on."""
    if not findings:
        return "No injection patterns detected"

    kinds = sorted({finding.type for finding in findings})
    return f"{len(findings)} potential injection(s): {', '.join(kinds)}"
