"""Generic RSS/Atom connector.

One connector serves any number of feeds, declared by the active Radar
Profile rather than by code. This is what lets a radar watch a domain that
publishes no academic literature -- competitor announcements, official
bulletins, regulator press rooms -- without writing a connector per site.

Feeds in the wild break the specification routinely: dates in several
formats, HTML inside descriptions, missing fields, servers returning 500.
Parsing therefore degrades per entry and per feed, so one bad source never
costs an ingestion run.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any

import httpx

try:
    from defusedxml import ElementTree as ET  # noqa: N817
except ImportError:
    from xml.etree import ElementTree as ET  # type: ignore[no-redef]  # noqa: N817

from app.connectors.base import BaseConnector, ConnectorResult, NormalizedPaper
from app.core.logging import get_logger

logger = get_logger(__name__)

_ATOM_NS = "{http://www.w3.org/2005/Atom}"

# Entries are signals about the domain, not research papers. The schema's
# document_type check constraint already allows exactly this.
_DOCUMENT_TYPE = "strategic_signal"

_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


class RssConnector(BaseConnector):
    """Fetches and normalises entries from a list of RSS or Atom feeds."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        settings = config or {}
        self.feeds, self.feed_names = _read_feeds(settings)
        self._fetch_errors: list[dict[str, str]] = []

        super().__init__(
            # Feeds are absolute URLs, so there is no single base to resolve
            # against; each request carries its own.
            source_name="rss",
            base_url="",
            config=settings,
            rate_limit=settings.get("rate_limit_per_second", 5.0),
            rate_limit_period=1.0,
        )

    async def fetch(self) -> dict[str, Any]:
        """Retrieve every configured feed.

        Returns:
            A mapping with the retrieved feeds and the failures, so a partial
            run is still a usable run.
        """
        feeds: list[dict[str, str]] = []
        errors: list[dict[str, str]] = []

        for url in self.feeds:
            try:
                response = await self._client.get(url)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                logger.warning("Feed request failed", feed=url, error=str(exc))
                errors.append({"feed": url, "error": str(exc)})
                continue

            feeds.append({"url": url, "xml": response.text})

        logger.info("Fetched feeds", retrieved=len(feeds), failed=len(errors))
        self._fetch_errors = errors
        return {"feeds": feeds, "errors": errors}

    async def run(self) -> ConnectorResult:
        """Run the pipeline, surfacing per-feed failures in the result.

        The base implementation only records exceptions, but a partially
        successful fetch raises nothing: without this, a feed that has been
        returning 404 for weeks would never appear in an ingestion run.
        """
        result = await super().run()

        result.errors.extend(
            {
                "message": f"Feed unavailable: {error['error']}",
                "feed": error["feed"],
                "timestamp": datetime.now(UTC).isoformat(),
            }
            for error in self._fetch_errors
        )
        return result

    def parse(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
        """Turn the retrieved documents into entry dictionaries."""
        items: list[dict[str, Any]] = []

        for feed in raw_data.get("feeds", []):
            try:
                items.extend(self._parse_feed(feed["url"], feed["xml"]))
            except Exception as exc:
                # A malformed document must not take the healthy feeds with it.
                logger.warning("Feed parsing failed", feed=feed.get("url"), error=str(exc))

        return items

    def normalize(self, parsed_item: dict[str, Any]) -> NormalizedPaper:
        """Convert one entry into the shape the pipeline consumes."""
        feed_url = parsed_item.get("feed_url", "")
        origin = self.feed_names.get(feed_url) or parsed_item.get("feed_title") or None

        return NormalizedPaper(
            title=parsed_item["title"],
            original_url=parsed_item.get("link"),
            abstract=parsed_item.get("summary") or None,
            publication_date=parsed_item.get("published"),
            journal_or_origin=origin,
            authors=[{"name": name} for name in parsed_item.get("authors", [])],
            document_type=_DOCUMENT_TYPE,
            raw_data=parsed_item,
        )

    def _parse_feed(self, url: str, xml: str) -> list[dict[str, Any]]:
        """Parse a single document, RSS 2.0 or Atom."""
        if not xml or not xml.strip():
            return []

        root = ET.fromstring(xml)

        channel = root.find("channel")
        if channel is not None:
            feed_title = _text(channel.find("title"))
            entries = channel.findall("item")
            parser = self._parse_rss_item
        else:
            feed_title = _text(root.find(f"{_ATOM_NS}title"))
            entries = root.findall(f"{_ATOM_NS}entry")
            parser = self._parse_atom_entry

        items: list[dict[str, Any]] = []
        for entry in entries:
            try:
                item = parser(entry)
            except Exception as exc:
                logger.warning("Entry parsing failed", feed=url, error=str(exc))
                continue

            # Without a title there is nothing for the pipeline to classify.
            if not item or not item.get("title"):
                continue

            item["feed_url"] = url
            item["feed_title"] = feed_title
            items.append(item)

        return items

    @staticmethod
    def _parse_rss_item(entry: Any) -> dict[str, Any]:
        return {
            "title": _clean(_text(entry.find("title"))),
            "link": _text(entry.find("link")) or _text(entry.find("guid")),
            "summary": _clean(_text(entry.find("description"))),
            "published": _to_date(_text(entry.find("pubDate"))),
            "authors": [a for a in [_text(entry.find("author"))] if a],
        }

    @staticmethod
    def _parse_atom_entry(entry: Any) -> dict[str, Any]:
        link_el = entry.find(f"{_ATOM_NS}link")
        summary = entry.find(f"{_ATOM_NS}summary")
        if summary is None:
            summary = entry.find(f"{_ATOM_NS}content")

        published = _text(entry.find(f"{_ATOM_NS}published")) or _text(entry.find(f"{_ATOM_NS}updated"))

        authors = [
            name
            for name in (
                _text(author.find(f"{_ATOM_NS}name")) for author in entry.findall(f"{_ATOM_NS}author")
            )
            if name
        ]

        return {
            "title": _clean(_text(entry.find(f"{_ATOM_NS}title"))),
            "link": (link_el.get("href") if link_el is not None else None)
            or _text(entry.find(f"{_ATOM_NS}id")),
            "summary": _clean(_text(summary)),
            "published": _to_date(published),
            "authors": authors,
        }


def _read_feeds(config: dict[str, Any]) -> tuple[list[str], dict[str, str]]:
    """Read the feed list, accepting plain URLs or {url, name} mappings.

    Raises:
        ValueError: If no feed is configured. An empty connector would report
            "nothing new" forever, which is indistinguishable from working.
    """
    raw = config.get("feeds") or []

    urls: list[str] = []
    names: dict[str, str] = {}

    for feed in raw:
        if isinstance(feed, dict):
            url = feed.get("url")
            if not url:
                continue
            urls.append(url)
            if feed.get("name"):
                names[url] = feed["name"]
        elif feed:
            urls.append(str(feed))

    if not urls:
        raise ValueError(
            "the rss connector has no feeds configured; declare them under the "
            "source's config.feeds in the active Radar Profile"
        )

    return urls, names


def _text(element: Any) -> str:
    """The stripped text of an element, or an empty string when absent."""
    if element is None or element.text is None:
        return ""
    return str(element.text).strip()


def _clean(value: str) -> str:
    """Strip markup and collapse whitespace.

    Feed descriptions routinely carry HTML, which would otherwise reach the
    LLM as raw tags and waste context on markup.
    """
    if not value:
        return ""
    return _WHITESPACE_RE.sub(" ", _TAG_RE.sub("", unescape(value))).strip()


def _to_date(value: str) -> date | None:
    """Parse a feed date, returning None rather than failing the entry.

    RSS uses RFC 822 and Atom uses ISO 8601, and plenty of feeds use neither.
    """
    if not value:
        return None

    try:
        return parsedate_to_datetime(value).date()
    except (TypeError, ValueError):
        pass

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        logger.debug("Unrecognised feed date", value=value)
        return None
