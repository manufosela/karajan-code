"""Seed data - default sources and configuration

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-19
"""

import uuid as _uuid
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uid(s: str) -> _uuid.UUID:
    """Convert a UUID string to a uuid.UUID object for cross-dialect compatibility."""
    return _uuid.UUID(s)


# Table definitions for bulk_insert
_sources_table = sa.table(
    "sources",
    sa.column("id", sa.Uuid),
    sa.column("name", sa.String),
    sa.column("source_type", sa.String),
    sa.column("category", sa.String),
    sa.column("priority", sa.Integer),
    sa.column("enabled", sa.Boolean),
    sa.column("base_url", sa.String),
    sa.column("config", sa.JSON),
)

_config_table = sa.table(
    "configuration",
    sa.column("id", sa.Uuid),
    sa.column("category", sa.String),
    sa.column("key", sa.String),
    sa.column("value", sa.JSON),
    sa.column("description", sa.String),
)

# =====================================================================
# SEED DATA
# =====================================================================

_SOURCES = [
    {
        "id": _uid("a0000001-0001-4000-a000-000000000001"),
        "name": "PubMed",
        "source_type": "api",
        "category": "core",
        "priority": 1,
        "enabled": True,
        "base_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
        "config": ({
            "search_endpoint": "esearch.fcgi",
            "fetch_endpoint": "efetch.fcgi",
            "db": "pubmed",
            "retmax": 100,
            "default_query": (
                "(orthodontics OR aligners OR clear aligners OR malocclusion "
                'OR tooth movement) AND ("last 7 days"[dp])'
            ),
            "rate_limit_per_second": 3,
            "api_key_env": "PUBMED_API_KEY",
        }),
    },
    {
        "id": _uid("a0000001-0002-4000-a000-000000000002"),
        "name": "arXiv",
        "source_type": "api",
        "category": "core",
        "priority": 2,
        "enabled": True,
        "base_url": "https://export.arxiv.org/api/",
        "config": ({
            "search_endpoint": "query",
            "max_results": 50,
            "default_categories": ["cs.AI", "cs.CV", "cs.LG", "physics.med-ph", "q-bio.QM"],
            "default_query": (
                "orthodontics OR dental alignment OR tooth segmentation "
                "OR cephalometric OR intraoral scan"
            ),
            "sort_by": "submittedDate",
            "sort_order": "descending",
        }),
    },
    {
        "id": _uid("a0000001-0003-4000-a000-000000000003"),
        "name": "ClinicalTrials.gov",
        "source_type": "api",
        "category": "core",
        "priority": 2,
        "enabled": True,
        "base_url": "https://clinicaltrials.gov/api/v2/",
        "config": ({
            "search_endpoint": "studies",
            "page_size": 50,
            "default_query": (
                "orthodontics OR clear aligners OR malocclusion "
                "OR tooth movement OR dental biomechanics"
            ),
            "status_filter": ["RECRUITING", "NOT_YET_RECRUITING", "COMPLETED"],
            "fields": (
                "NCTId,BriefTitle,OfficialTitle,BriefSummary,Condition,"
                "InterventionName,StudyType,OverallStatus,StartDate,"
                "CompletionDate,LeadSponsorName"
            ),
        }),
    },
    {
        "id": _uid("a0000001-0004-4000-a000-000000000004"),
        "name": "Crossref",
        "source_type": "api",
        "category": "core",
        "priority": 3,
        "enabled": True,
        "base_url": "https://api.crossref.org/",
        "config": ({
            "search_endpoint": "works",
            "rows": 50,
            "default_query": "orthodontics aligners biomechanics tooth movement",
            "filter": "from-pub-date:2024-01-01",
            "sort": "published",
            "order": "desc",
            "mailto_env": "CROSSREF_MAILTO",
        }),
    },
    {
        "id": _uid("a0000001-0005-4000-a000-000000000005"),
        "name": "Semantic Scholar",
        "source_type": "api",
        "category": "core",
        "priority": 3,
        "enabled": True,
        "base_url": "https://api.semanticscholar.org/graph/v1/",
        "config": ({
            "search_endpoint": "paper/search",
            "limit": 50,
            "default_query": "orthodontics clear aligners biomechanics AI dental",
            "fields": (
                "title,abstract,authors,year,venue,externalIds,"
                "citationCount,influentialCitationCount,publicationDate,journal"
            ),
            "year_filter": "2024-",
            "api_key_env": "SEMANTIC_SCHOLAR_API_KEY",
        }),
    },
]

_CONFIGURATIONS = [
    {
        "id": _uid("b0000001-0001-4000-a000-000000000001"),
        "category": "thematic",
        "key": "orthodontics_keywords",
        "description": "Hierarchical keyword sets for orthodontics research classification",
        "value": ({
            "primary": [
                "clear aligners", "invisible aligners", "orthodontic aligners",
                "tooth movement", "orthodontic treatment", "malocclusion",
                "dental alignment", "bite correction", "orthodontic biomechanics",
                "aligner therapy", "sequential aligners", "thermoplastic aligners",
            ],
            "materials": [
                "shape memory polymer", "thermoplastic polyurethane", "PETG",
                "aligner material", "dental polymer", "biocompatible polymer",
                "orthodontic wire", "NiTi", "nickel titanium",
                "3D printed aligner", "direct printed aligner",
            ],
            "digital_workflow": [
                "intraoral scanner", "digital impression", "CBCT",
                "cephalometric analysis", "treatment planning software",
                "digital orthodontics", "CAD/CAM dental", "STL dental",
                "tooth segmentation", "dental AI", "orthodontic AI",
            ],
            "clinical": [
                "root resorption", "attachment design", "aligner attachment",
                "interproximal reduction", "IPR", "staging protocol",
                "overcorrection", "refinement aligner", "retention",
                "Class II correction", "Class III correction", "open bite",
                "deep bite", "crossbite", "crowding", "spacing",
            ],
            "manufacturing": [
                "thermoforming", "direct 3D printing", "additive manufacturing dental",
                "dental 3D printing", "SLA dental", "DLP dental",
                "aligner production", "mass customization dental",
            ],
            "emerging": [
                "AI orthodontics", "machine learning dental", "deep learning dental",
                "computer vision dental", "automated treatment planning",
                "remote monitoring orthodontics", "dental telehealth",
                "bioprinting dental", "smart aligner", "sensor aligner",
            ],
        }),
    },
    {
        "id": _uid("b0000001-0002-4000-a000-000000000002"),
        "category": "thematic",
        "key": "strategic_buckets",
        "description": "Strategic bucket definitions for classifying research relevance to business areas",
        "value": ({
            "buckets": [
                {
                    "id": "product_clinical",
                    "name": "Product & Clinical Evidence",
                    "description": "Clinical outcomes, treatment efficacy, patient outcomes, comparative studies",
                    "keywords": ["clinical trial", "treatment outcome", "efficacy",
                                 "patient satisfaction", "evidence-based"],
                },
                {
                    "id": "biomechanics",
                    "name": "Biomechanics & Tooth Movement",
                    "description": (
                        "Force systems, tooth movement mechanics, "
                        "finite element analysis, biological response"
                    ),
                    "keywords": ["biomechanics", "force system", "tooth movement",
                                 "FEA", "finite element", "PDL", "bone remodeling"],
                },
                {
                    "id": "materials",
                    "name": "Materials & Science",
                    "description": "New materials, polymer science, material properties, degradation, biocompatibility",
                    "keywords": ["material", "polymer", "biocompatible",
                                 "mechanical properties", "degradation", "thermoplastic"],
                },
                {
                    "id": "ai_software",
                    "name": "AI & Software",
                    "description": (
                        "Artificial intelligence, machine learning, "
                        "treatment planning algorithms, computer vision"
                    ),
                    "keywords": ["artificial intelligence", "machine learning", "deep learning",
                                 "neural network", "computer vision", "algorithm"],
                },
                {
                    "id": "manufacturing_operations",
                    "name": "Manufacturing & Operations",
                    "description": "Production processes, 3D printing, thermoforming, quality control, supply chain",
                    "keywords": ["manufacturing", "3D printing", "thermoforming",
                                 "additive manufacturing", "quality control", "production"],
                },
                {
                    "id": "research_partnerships",
                    "name": "Research Partnerships & University",
                    "description": "Academic collaborations, university research, grants, partnerships",
                    "keywords": ["university", "research group", "collaboration",
                                 "grant", "partnership", "academic"],
                },
                {
                    "id": "risk_disruption",
                    "name": "Risk & Disruption",
                    "description": "Disruptive technologies, competitive threats, regulatory changes, market shifts",
                    "keywords": ["disruption", "breakthrough", "paradigm shift",
                                 "regulatory", "patent", "competitor"],
                },
            ],
        }),
    },
    {
        "id": _uid("b0000001-0003-4000-a000-000000000003"),
        "category": "scoring",
        "key": "strategic_relevance_weights",
        "description": "Weighted scoring formula for strategic relevance calculation. Weights must sum to 1.0.",
        "value": ({
            "weights": {
                "proximity_to_aligners": 0.25,
                "impact": 0.20,
                "evidence_quality": 0.15,
                "time_to_applicability": 0.15,
                "novelty": 0.10,
                "competitive_advantage": 0.10,
                "strategic_priority_affinity": 0.05,
            },
            "score_range": {"min": 0, "max": 10},
            "thresholds": {
                "high_relevance": 7.0,
                "medium_relevance": 4.0,
                "low_relevance": 0.0,
            },
        }),
    },
    {
        "id": _uid("b0000001-0004-4000-a000-000000000004"),
        "category": "scoring",
        "key": "scientific_strength_criteria",
        "description": "Criteria and weights for evaluating scientific strength of research items",
        "value": ({
            "criteria": {
                "study_design": {
                    "weight": 0.30,
                    "levels": {
                        "systematic_review_meta_analysis": 10,
                        "rct": 9,
                        "prospective_cohort": 7,
                        "retrospective_cohort": 6,
                        "case_control": 5,
                        "case_series": 4,
                        "case_report": 3,
                        "in_vitro": 4,
                        "fea_simulation": 3,
                        "expert_opinion": 2,
                        "preprint_no_review": 1,
                    },
                },
                "sample_size": {
                    "weight": 0.20,
                    "levels": {
                        "large_n_gt_100": 10,
                        "medium_n_30_100": 7,
                        "small_n_10_30": 4,
                        "very_small_n_lt_10": 2,
                        "not_applicable": 5,
                    },
                },
                "journal_impact": {
                    "weight": 0.20,
                    "levels": {
                        "top_tier_if_gt_5": 10,
                        "high_if_3_5": 8,
                        "medium_if_1_3": 5,
                        "low_if_lt_1": 3,
                        "preprint_no_journal": 1,
                    },
                },
                "methodology_rigor": {
                    "weight": 0.15,
                    "description": "LLM assessment of methodological quality",
                },
                "recency": {
                    "weight": 0.15,
                    "levels": {
                        "last_3_months": 10,
                        "last_6_months": 8,
                        "last_year": 6,
                        "last_2_years": 4,
                        "older": 2,
                    },
                },
            },
        }),
    },
    {
        "id": _uid("b0000001-0005-4000-a000-000000000005"),
        "category": "delivery",
        "key": "daily_digest_settings",
        "description": "Daily digest delivery configuration: threshold scores, max items, language, and schedule",
        "value": ({
            "teams_threshold": 6.0,
            "max_daily_insights": 5,
            "output_language": "both",
            "digest_schedule": "09:00",
            "digest_timezone": "Europe/Madrid",
            "include_sections": [
                "top_insights",
                "strategic_summary",
                "new_opportunities",
                "follow_up_items",
            ],
            "teams_webhook_env": "TEAMS_WEBHOOK_URL",
            "email_recipients_env": "DIGEST_EMAIL_RECIPIENTS",
        }),
    },
    {
        "id": _uid("b0000001-0006-4000-a000-000000000006"),
        "category": "llm",
        "key": "classification_settings",
        "description": "LLM provider and model configuration for research item classification",
        "value": ({
            "default_provider": "anthropic",
            "default_model": "claude-sonnet-4-20250514",
            "temperature": 0.2,
            "max_tokens": 4096,
            "prompt_version": "v1.0.0",
            "retry_attempts": 3,
            "retry_delay_ms": 1000,
            "fallback_provider": "openai",
            "fallback_model": "gpt-4o",
            "batch_size": 10,
            "rate_limit_rpm": 50,
        }),
    },
    {
        "id": _uid("b0000001-0007-4000-a000-000000000007"),
        "category": "general",
        "key": "system_settings",
        "description": "General system-wide settings for the Ortho Frontier Radar",
        "value": ({
            "project_name": "Ortho Frontier Radar",
            "version": "1.0.0",
            "dedup_strategy": "content_hash",
            "normalized_title_match_threshold": 0.92,
            "max_abstract_length": 10000,
            "default_lookback_days": 7,
            "enabled_document_types": [
                "paper", "review", "clinical_trial", "preprint",
                "university_publication", "journal_article", "strategic_signal",
            ],
        }),
    },
    {
        "id": _uid("b0000001-0008-4000-a000-000000000008"),
        "category": "general",
        "key": "review_status_definitions",
        "description": "Definitions of each review status for documentation and UI display",
        "value": ({
            "relevant": "Confirmed relevant to strategic interests, included in reporting",
            "review": "Pending human review, default status for newly ingested items",
            "discarded": "Reviewed and determined not relevant, excluded from reporting",
            "opportunity": "Identified as a concrete business or research opportunity",
            "follow_up": "Requires additional investigation or monitoring over time",
        }),
    },
    {
        "id": _uid("b0000001-0009-4000-a000-000000000009"),
        "category": "sources",
        "key": "ingestion_schedule",
        "description": "Scheduling configuration for source ingestion jobs",
        "value": ({
            "default_interval_hours": 24,
            "core_sources_interval_hours": 12,
            "university_sources_interval_hours": 168,
            "max_concurrent_fetches": 3,
            "global_timeout_seconds": 300,
            "retry_failed_after_hours": 6,
        }),
    },
]


def upgrade() -> None:
    op.bulk_insert(_sources_table, _SOURCES)
    op.bulk_insert(_config_table, _CONFIGURATIONS)


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM configuration WHERE (category, key) IN ("
            "('thematic','orthodontics_keywords'),('thematic','strategic_buckets'),"
            "('scoring','strategic_relevance_weights'),('scoring','scientific_strength_criteria'),"
            "('delivery','daily_digest_settings'),('llm','classification_settings'),"
            "('general','system_settings'),('general','review_status_definitions'),"
            "('sources','ingestion_schedule'))"
        )
    )
    op.execute(
        sa.text(
            "DELETE FROM sources WHERE name IN "
            "('PubMed','arXiv','ClinicalTrials.gov','Crossref','Semantic Scholar')"
        )
    )
