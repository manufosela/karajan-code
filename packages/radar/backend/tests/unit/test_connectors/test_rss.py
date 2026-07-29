"""Tests for the generic RSS/Atom connector.

Real-world feeds break the specification constantly: dates in half a dozen
formats, HTML inside descriptions, missing fields, feeds that simply return
500. The connector has to degrade per entry and per feed rather than losing a
whole ingestion run.
"""

from __future__ import annotations

from datetime import date

import httpx
import pytest
import respx

from app.connectors.rss import RssConnector

FEED_A = "https://example.com/news.xml"
FEED_B = "https://example.org/atom.xml"


RSS_2_0 = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Mobility News</title>
    <link>https://example.com</link>
    <item>
      <title>City launches carpooling incentive</title>
      <link>https://example.com/a</link>
      <description>The council approved a subsidy for shared commuting.</description>
      <pubDate>Mon, 15 Mar 2026 10:00:00 GMT</pubDate>
      <guid>https://example.com/a</guid>
    </item>
    <item>
      <title>Energy bill support extended</title>
      <link>https://example.com/b</link>
      <description>&lt;p&gt;The scheme now covers &lt;b&gt;more&lt;/b&gt; households.&lt;/p&gt;</description>
      <pubDate>Tue, 16 Mar 2026 08:30:00 +0100</pubDate>
    </item>
  </channel>
</rss>
"""

ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Policy Watch</title>
  <entry>
    <title>New directive on shared transport</title>
    <link href="https://example.org/1"/>
    <summary>The directive sets occupancy targets.</summary>
    <updated>2026-03-14T09:00:00Z</updated>
    <id>urn:uuid:1</id>
    <author><name>Policy Desk</name></author>
  </entry>
</feed>
"""


def _connector(**config) -> RssConnector:
    return RssConnector(config={"feeds": [FEED_A], **config})


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class TestConfiguration:
    def test_reads_feeds_from_config(self) -> None:
        connector = RssConnector(config={"feeds": [FEED_A, FEED_B]})

        assert connector.feeds == [FEED_A, FEED_B]

    def test_accepts_feeds_declared_as_mappings_with_a_name(self) -> None:
        connector = RssConnector(config={"feeds": [{"url": FEED_A, "name": "Mobility News"}]})

        assert connector.feeds == [FEED_A]
        assert connector.feed_names[FEED_A] == "Mobility News"

    def test_rejects_a_configuration_without_feeds(self) -> None:
        """A silent empty run would look like 'no news today' forever."""
        with pytest.raises(ValueError, match="no feeds"):
            RssConnector(config={})

    def test_rejects_an_empty_feed_list(self) -> None:
        with pytest.raises(ValueError, match="no feeds"):
            RssConnector(config={"feeds": []})

    def test_is_registered_as_rss(self) -> None:
        from app.connectors.registry import ConnectorRegistry

        registry = ConnectorRegistry()
        registry.register("rss", RssConnector)

        assert "rss" in registry.registered_names


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------


class TestFetch:
    @respx.mock
    async def test_fetches_every_configured_feed(self) -> None:
        respx.get(FEED_A).mock(return_value=httpx.Response(200, text=RSS_2_0))
        respx.get(FEED_B).mock(return_value=httpx.Response(200, text=ATOM))
        connector = RssConnector(config={"feeds": [FEED_A, FEED_B]})

        raw = await connector.fetch()

        assert len(raw["feeds"]) == 2
        await connector.close()

    @respx.mock
    async def test_one_failing_feed_does_not_lose_the_others(self) -> None:
        respx.get(FEED_A).mock(return_value=httpx.Response(500, text="boom"))
        respx.get(FEED_B).mock(return_value=httpx.Response(200, text=ATOM))
        connector = RssConnector(config={"feeds": [FEED_A, FEED_B]})

        raw = await connector.fetch()

        assert len(raw["feeds"]) == 1
        assert len(raw["errors"]) == 1
        assert FEED_A in raw["errors"][0]["feed"]
        await connector.close()

    @respx.mock
    async def test_records_a_connection_failure_as_an_error(self) -> None:
        respx.get(FEED_A).mock(side_effect=httpx.ConnectError("refused"))
        connector = _connector()

        raw = await connector.fetch()

        assert raw["feeds"] == []
        assert len(raw["errors"]) == 1
        await connector.close()


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


class TestParseRss:
    def test_extracts_every_item(self) -> None:
        connector = _connector()

        items = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})

        assert len(items) == 2

    def test_maps_the_core_fields(self) -> None:
        connector = _connector()

        first = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[0]

        assert first["title"] == "City launches carpooling incentive"
        assert first["link"] == "https://example.com/a"
        assert first["summary"] == "The council approved a subsidy for shared commuting."

    def test_parses_an_rfc_822_date(self) -> None:
        connector = _connector()

        first = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[0]

        assert first["published"] == date(2026, 3, 15)

    def test_parses_an_rfc_822_date_with_a_numeric_offset(self) -> None:
        connector = _connector()

        second = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[1]

        assert second["published"] == date(2026, 3, 16)

    def test_strips_html_from_the_summary(self) -> None:
        """Descriptions routinely carry markup, which would reach the LLM raw."""
        connector = _connector()

        second = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[1]

        assert second["summary"] == "The scheme now covers more households."

    def test_carries_the_feed_title_as_the_origin(self) -> None:
        connector = _connector()

        first = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[0]

        assert first["feed_title"] == "Mobility News"


class TestParseAtom:
    def test_extracts_entries(self) -> None:
        connector = _connector()

        items = connector.parse({"feeds": [{"url": FEED_B, "xml": ATOM}], "errors": []})

        assert len(items) == 1

    def test_maps_atom_fields(self) -> None:
        connector = _connector()

        entry = connector.parse({"feeds": [{"url": FEED_B, "xml": ATOM}], "errors": []})[0]

        assert entry["title"] == "New directive on shared transport"
        assert entry["link"] == "https://example.org/1"
        assert entry["summary"] == "The directive sets occupancy targets."
        assert entry["published"] == date(2026, 3, 14)

    def test_extracts_the_author(self) -> None:
        connector = _connector()

        entry = connector.parse({"feeds": [{"url": FEED_B, "xml": ATOM}], "errors": []})[0]

        assert entry["authors"] == ["Policy Desk"]


class TestParseResilience:
    def test_malformed_xml_yields_no_items_instead_of_raising(self) -> None:
        connector = _connector()

        items = connector.parse({"feeds": [{"url": FEED_A, "xml": "<rss><channel><item>"}], "errors": []})

        assert items == []

    def test_a_broken_feed_does_not_discard_a_healthy_one(self) -> None:
        connector = _connector()

        items = connector.parse(
            {
                "feeds": [
                    {"url": FEED_A, "xml": "not xml at all"},
                    {"url": FEED_B, "xml": ATOM},
                ],
                "errors": [],
            }
        )

        assert len(items) == 1

    def test_an_item_without_a_title_is_skipped(self) -> None:
        """Title is the one field the pipeline cannot work without."""
        xml = "<rss><channel><item><link>https://x/1</link></item></channel></rss>"
        connector = _connector()

        assert connector.parse({"feeds": [{"url": FEED_A, "xml": xml}], "errors": []}) == []

    def test_an_unparseable_date_leaves_the_item_usable(self) -> None:
        xml = "<rss><channel><item><title>T</title><pubDate>whenever</pubDate></item></channel></rss>"
        connector = _connector()

        item = connector.parse({"feeds": [{"url": FEED_A, "xml": xml}], "errors": []})[0]

        assert item["published"] is None
        assert item["title"] == "T"

    def test_empty_xml_yields_no_items(self) -> None:
        connector = _connector()

        assert connector.parse({"feeds": [{"url": FEED_A, "xml": ""}], "errors": []}) == []


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------


class TestNormalize:
    def test_produces_a_normalized_paper(self) -> None:
        connector = _connector()
        item = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[0]

        paper = connector.normalize(item)

        assert paper.title == "City launches carpooling incentive"
        assert paper.original_url == "https://example.com/a"
        assert paper.abstract == "The council approved a subsidy for shared commuting."
        assert paper.publication_date == date(2026, 3, 15)

    def test_classifies_entries_as_strategic_signals(self) -> None:
        """A news item is not a paper; the schema has a type for exactly this."""
        connector = _connector()
        item = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[0]

        assert connector.normalize(item).document_type == "strategic_signal"

    def test_uses_the_feed_title_as_the_origin(self) -> None:
        connector = _connector()
        item = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[0]

        assert connector.normalize(item).journal_or_origin == "Mobility News"

    def test_prefers_the_configured_feed_name_over_the_feed_title(self) -> None:
        connector = RssConnector(config={"feeds": [{"url": FEED_A, "name": "Council feed"}]})
        item = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[0]

        assert connector.normalize(item).journal_or_origin == "Council feed"

    def test_keeps_the_raw_entry_for_traceability(self) -> None:
        connector = _connector()
        item = connector.parse({"feeds": [{"url": FEED_A, "xml": RSS_2_0}], "errors": []})[0]

        assert connector.normalize(item).raw_data["link"] == "https://example.com/a"

    def test_maps_atom_authors_into_the_author_list(self) -> None:
        connector = _connector()
        entry = connector.parse({"feeds": [{"url": FEED_B, "xml": ATOM}], "errors": []})[0]

        assert connector.normalize(entry).authors == [{"name": "Policy Desk"}]


# ---------------------------------------------------------------------------
# End to end
# ---------------------------------------------------------------------------


class TestRun:
    @respx.mock
    async def test_run_returns_papers_from_all_feeds(self) -> None:
        respx.get(FEED_A).mock(return_value=httpx.Response(200, text=RSS_2_0))
        respx.get(FEED_B).mock(return_value=httpx.Response(200, text=ATOM))
        connector = RssConnector(config={"feeds": [FEED_A, FEED_B]})

        result = await connector.run()

        assert result.success_count == 3
        assert result.source_name == "rss"
        await connector.close()

    @respx.mock
    async def test_run_reports_a_failing_feed_without_losing_the_rest(self) -> None:
        respx.get(FEED_A).mock(return_value=httpx.Response(404, text="gone"))
        respx.get(FEED_B).mock(return_value=httpx.Response(200, text=ATOM))
        connector = RssConnector(config={"feeds": [FEED_A, FEED_B]})

        result = await connector.run()

        assert result.success_count == 1
        assert result.error_count == 1
        await connector.close()
