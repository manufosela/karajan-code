"""PubMed connector using NCBI E-utilities API."""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta
from typing import Any

try:
    from defusedxml import ElementTree as ET  # noqa: N817
except ImportError:
    from xml.etree import ElementTree as ET  # type: ignore[no-redef]  # noqa: N817

from app.connectors.base import BaseConnector, NormalizedPaper
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# NCBI E-utilities base URL
EUTILS_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"

# Default orthodontics search query
DEFAULT_QUERY = (
    "(orthodontics OR \"clear aligners\" OR \"dental biomechanics\" "
    "OR \"malocclusion treatment\" OR \"tooth movement\" OR \"aligner\")"
)

# Maximum PMIDs per efetch batch
BATCH_SIZE = 200


class PubMedConnector(BaseConnector):
    """Connector for fetching research papers from PubMed via NCBI E-utilities.

    Uses esearch.fcgi for searching and efetch.fcgi for fetching full records.
    Rate limits: 3 req/s without API key, 10 req/s with API key.
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        api_key: str | None = None,
        email: str | None = None,
    ) -> None:
        self._api_key = api_key or settings.PUBMED_API_KEY
        self._email = email or getattr(settings, "CROSSREF_MAILTO", None) or "ortho-frontier-radar@geniova.com"

        rate_limit = 10.0 if self._api_key else 3.0

        super().__init__(
            source_name="pubmed",
            base_url=EUTILS_BASE_URL,
            config=config or {},
            rate_limit=rate_limit,
            rate_limit_period=1.0,
        )

    async def fetch(
        self,
        query: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        max_results: int = 500,
    ) -> dict[str, Any]:
        """Fetch articles from PubMed matching orthodontics queries.

        Uses esearch to get PMIDs, then efetch to get full records in XML.

        Args:
            query: Custom search query. Defaults to orthodontics-related terms.
            date_from: Start date for filtering. Defaults to 7 days ago.
            date_to: End date for filtering. Defaults to today.
            max_results: Maximum number of results to fetch.

        Returns:
            Dict with 'xml' key containing raw XML string from efetch,
            and 'pmids' key with the list of PMIDs found.
        """
        if date_from is None:
            date_from = date.today() - timedelta(days=7)
        if date_to is None:
            date_to = date.today()

        search_query = query or DEFAULT_QUERY
        date_range = f" AND {date_from:%Y/%m/%d}:{date_to:%Y/%m/%d}[edat]"
        full_query = search_query + date_range

        # Build esearch parameters
        esearch_params: dict[str, Any] = {
            "db": "pubmed",
            "term": full_query,
            "retmax": max_results,
            "retmode": "xml",
            "tool": "ortho-frontier-radar",
            "email": self._email,
        }
        if self._api_key:
            esearch_params["api_key"] = self._api_key

        # Step 1: esearch to get PMIDs
        logger.info("Searching PubMed", query=full_query, max_results=max_results)
        async with self._limiter:
            esearch_response = await self._client.get("esearch.fcgi", params=esearch_params)
            esearch_response.raise_for_status()

        esearch_xml = esearch_response.text
        pmids = self._extract_pmids(esearch_xml)

        if not pmids:
            logger.info("No PMIDs found for query", query=full_query)
            return {"xml": "", "pmids": []}

        logger.info("Found PMIDs", count=len(pmids))

        # Step 2: efetch in batches of BATCH_SIZE
        all_xml_parts: list[str] = []
        for i in range(0, len(pmids), BATCH_SIZE):
            batch = pmids[i : i + BATCH_SIZE]
            efetch_params: dict[str, Any] = {
                "db": "pubmed",
                "id": ",".join(batch),
                "rettype": "xml",
                "retmode": "xml",
                "tool": "ortho-frontier-radar",
                "email": self._email,
            }
            if self._api_key:
                efetch_params["api_key"] = self._api_key

            async with self._limiter:
                efetch_response = await self._client.get("efetch.fcgi", params=efetch_params)
                efetch_response.raise_for_status()

            all_xml_parts.append(efetch_response.text)

        combined_xml = "\n".join(all_xml_parts)
        return {"xml": combined_xml, "pmids": pmids}

    @staticmethod
    def _extract_pmids(esearch_xml: str) -> list[str]:
        """Extract PMIDs from esearch XML response."""
        try:
            root = ET.fromstring(esearch_xml)
        except ET.ParseError:
            logger.error("Failed to parse esearch XML response")
            return []

        id_list = root.find("IdList")
        if id_list is None:
            return []

        return [id_elem.text for id_elem in id_list.findall("Id") if id_elem.text]

    def parse(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
        """Parse PubMed XML (MedlineCitation format) into a list of article dicts.

        Args:
            raw_data: Dict with 'xml' key containing the raw XML string.

        Returns:
            List of dicts, each representing a parsed article.
        """
        xml_string = raw_data.get("xml", "")
        if not xml_string or not xml_string.strip():
            return []

        articles: list[dict[str, Any]] = []

        try:
            root = ET.fromstring(xml_string)
        except ET.ParseError:
            # Try wrapping in a root element if multiple PubmedArticleSet docs
            try:
                root = ET.fromstring(f"<Root>{xml_string}</Root>")
            except ET.ParseError:
                logger.error("Failed to parse PubMed XML")
                return []

        # Handle both <PubmedArticleSet> as root and articles directly
        pubmed_articles = root.findall(".//PubmedArticle")
        if not pubmed_articles:
            pubmed_articles = root.findall("PubmedArticle")

        for article_elem in pubmed_articles:
            try:
                parsed = self._parse_article(article_elem)
                if parsed:
                    articles.append(parsed)
            except Exception as e:
                logger.warning("Failed to parse PubMed article", error=str(e))

        return articles

    @staticmethod
    def _parse_article(article_elem: Any) -> dict[str, Any] | None:
        """Parse a single PubmedArticle element."""
        citation = article_elem.find("MedlineCitation")
        if citation is None:
            return None

        article = citation.find("Article")
        if article is None:
            return None

        # PMID
        pmid_elem = citation.find("PMID")
        pmid = pmid_elem.text if pmid_elem is not None and pmid_elem.text else None
        if not pmid:
            return None

        # Title
        title_elem = article.find("ArticleTitle")
        title = ""
        if title_elem is not None:
            # ArticleTitle may contain sub-elements (e.g., <i>, <b>), get all text
            title = "".join(title_elem.itertext()).strip()

        # Abstract - handles structured abstracts with multiple AbstractText elements
        abstract_parts: list[str] = []
        abstract_elem = article.find("Abstract")
        if abstract_elem is not None:
            for text_elem in abstract_elem.findall("AbstractText"):
                label = text_elem.get("Label", "")
                text = "".join(text_elem.itertext()).strip()
                if text:
                    if label:
                        abstract_parts.append(f"{label}: {text}")
                    else:
                        abstract_parts.append(text)
        abstract = " ".join(abstract_parts) if abstract_parts else None

        # Authors
        authors: list[dict[str, str]] = []
        author_list = article.find("AuthorList")
        if author_list is not None:
            for author_elem in author_list.findall("Author"):
                author_info: dict[str, str] = {}
                last_name = author_elem.find("LastName")
                fore_name = author_elem.find("ForeName")
                if last_name is not None and last_name.text:
                    author_info["last_name"] = last_name.text
                if fore_name is not None and fore_name.text:
                    author_info["fore_name"] = fore_name.text
                if last_name is not None and last_name.text:
                    name_parts = []
                    if fore_name is not None and fore_name.text:
                        name_parts.append(fore_name.text)
                    name_parts.append(last_name.text)
                    author_info["name"] = " ".join(name_parts)

                # Affiliations
                affiliations: list[str] = []
                for aff_elem in author_elem.findall("AffiliationInfo/Affiliation"):
                    if aff_elem.text:
                        affiliations.append(aff_elem.text)
                if affiliations:
                    author_info["affiliation"] = "; ".join(affiliations)

                if author_info:
                    authors.append(author_info)

        # MeSH terms
        mesh_terms: list[str] = []
        mesh_list = citation.find("MeshHeadingList")
        if mesh_list is not None:
            for heading in mesh_list.findall("MeshHeading"):
                descriptor = heading.find("DescriptorName")
                if descriptor is not None and descriptor.text:
                    mesh_terms.append(descriptor.text)

        # Journal
        journal_elem = article.find("Journal/Title")
        journal = journal_elem.text if journal_elem is not None and journal_elem.text else None

        # Publication date - try ArticleDate first, then PubDate
        pub_date_str = None

        article_date = article.find("ArticleDate")
        if article_date is not None:
            year = article_date.find("Year")
            month = article_date.find("Month")
            day = article_date.find("Day")
            if year is not None and year.text:
                parts = [year.text]
                if month is not None and month.text:
                    parts.append(month.text.zfill(2))
                    if day is not None and day.text:
                        parts.append(day.text.zfill(2))
                    else:
                        parts.append("01")
                else:
                    parts.extend(["01", "01"])
                pub_date_str = "-".join(parts)

        if not pub_date_str:
            pub_date = article.find("Journal/JournalIssue/PubDate")
            if pub_date is not None:
                year = pub_date.find("Year")
                month = pub_date.find("Month")
                day = pub_date.find("Day")
                medline_date = pub_date.find("MedlineDate")
                if year is not None and year.text:
                    parts = [year.text]
                    if month is not None and month.text:
                        # Month might be a name like "Jan"
                        month_text = month.text
                        try:
                            month_num = datetime.strptime(month_text, "%b").month
                            parts.append(str(month_num).zfill(2))
                        except ValueError:
                            try:
                                parts.append(month_text.zfill(2))
                            except (ValueError, AttributeError):
                                parts.append("01")
                        if day is not None and day.text:
                            parts.append(day.text.zfill(2))
                        else:
                            parts.append("01")
                    else:
                        parts.extend(["01", "01"])
                    pub_date_str = "-".join(parts)
                elif medline_date is not None and medline_date.text:
                    # Try to extract year from MedlineDate
                    try:
                        year_str = medline_date.text[:4]
                        pub_date_str = f"{year_str}-01-01"
                    except (ValueError, IndexError):
                        pass

        # DOI from ArticleIdList in PubmedData
        doi = None
        pubmed_data = article_elem.find("PubmedData")
        if pubmed_data is not None:
            article_id_list = pubmed_data.find("ArticleIdList")
            if article_id_list is not None:
                for aid in article_id_list.findall("ArticleId"):
                    if aid.get("IdType") == "doi" and aid.text:
                        doi = aid.text
                        break

        return {
            "pmid": pmid,
            "title": title,
            "abstract": abstract,
            "authors": authors,
            "mesh_terms": mesh_terms,
            "journal": journal,
            "publication_date": pub_date_str,
            "doi": doi,
        }

    def normalize(self, parsed_item: dict[str, Any]) -> NormalizedPaper:
        """Normalize a parsed PubMed article dict into a NormalizedPaper.

        Args:
            parsed_item: Dict from parse() representing one article.

        Returns:
            NormalizedPaper instance.
        """
        pmid = parsed_item.get("pmid", "")
        title = parsed_item.get("title", "")
        abstract = parsed_item.get("abstract")

        # Parse publication date
        pub_date = None
        pub_date_str = parsed_item.get("publication_date")
        if pub_date_str:
            try:
                pub_date = date.fromisoformat(pub_date_str)
            except (ValueError, TypeError):
                logger.warning("Could not parse publication date", pmid=pmid, date_str=pub_date_str)

        # Map MeSH terms to keywords in raw_data
        mesh_terms = parsed_item.get("mesh_terms", [])

        # Compute content hash from title + abstract
        content_hash = self.compute_content_hash(title, abstract or "")

        doi = parsed_item.get("doi")
        original_url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None

        return NormalizedPaper(
            doi=doi,
            pmid=pmid,
            title=title,
            authors=parsed_item.get("authors", []),
            publication_date=pub_date,
            abstract=abstract,
            journal_or_origin=parsed_item.get("journal"),
            document_type="paper",
            language="en",
            original_url=original_url,
            raw_data={
                "source": "pubmed",
                "source_id": pmid,
                "mesh_terms": mesh_terms,
                "keywords": mesh_terms,
                "content_hash": content_hash,
            },
        )

    @staticmethod
    def compute_content_hash(title: str, abstract: str) -> str:
        """Compute a SHA-256 hash of the paper content for deduplication."""
        content = f"{title.strip().lower()}|{abstract.strip().lower()}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()
