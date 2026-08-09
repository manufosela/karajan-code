-- =============================================================================
-- Frontier Radar - PostgreSQL Database Schema
-- Configurable strategic research radar (reference schema)
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- ENUM-LIKE DOMAIN TYPES (using CHECK constraints on columns instead)
-- =============================================================================

-- =============================================================================
-- TABLE: sources
-- Configurable research sources (PubMed, arXiv, ClinicalTrials.gov, etc.)
-- =============================================================================
CREATE TABLE sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    source_type     VARCHAR(20) NOT NULL,
    category        VARCHAR(20) NOT NULL,
    priority        INTEGER NOT NULL DEFAULT 5,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    config          JSONB DEFAULT '{}'::jsonb,
    base_url        TEXT,
    last_fetched_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_source_type CHECK (source_type IN ('api', 'rss', 'scraper')),
    CONSTRAINT chk_source_category CHECK (category IN ('core', 'university', 'journal', 'author')),
    CONSTRAINT chk_source_priority CHECK (priority BETWEEN 1 AND 10)
);

COMMENT ON TABLE sources IS 'Configurable research sources for ingesting scientific publications and signals';
COMMENT ON COLUMN sources.source_type IS 'Integration method: api (REST/SOAP), rss (feed), scraper (web scraping)';
COMMENT ON COLUMN sources.category IS 'Source classification: core (PubMed, arXiv...), university, journal, author';
COMMENT ON COLUMN sources.priority IS 'Fetch priority 1 (highest) to 10 (lowest)';
COMMENT ON COLUMN sources.config IS 'Source-specific configuration (API keys, query params, endpoints, etc.)';

-- =============================================================================
-- TABLE: research_items
-- Main table for all ingested research signals
-- =============================================================================
CREATE TABLE research_items (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id                       UUID NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,

    -- Identification
    doi                             VARCHAR(255),
    pmid                            VARCHAR(20),
    nct_id                          VARCHAR(20),
    arxiv_id                        VARCHAR(50),
    original_url                    TEXT,

    -- Content
    original_title                  TEXT NOT NULL,
    normalized_title                TEXT,
    authors                         JSONB DEFAULT '[]'::jsonb,
    publication_date                DATE,
    abstract                        TEXT,
    journal_or_origin               VARCHAR(500),
    document_type                   VARCHAR(30) NOT NULL,
    language                        VARCHAR(10) DEFAULT 'en',

    -- Classification
    thematic_tags                   JSONB DEFAULT '[]'::jsonb,
    strategic_buckets               JSONB DEFAULT '[]'::jsonb,

    -- Scoring
    scientific_strength_score       NUMERIC(4,2),
    scientific_strength_reasons     JSONB,
    strategic_relevance_score       NUMERIC(4,2),
    strategic_relevance_reasons     JSONB,

    -- Strategic analysis
    hype_risk                       VARCHAR(10),
    time_horizon                    VARCHAR(15),
    recommended_action              VARCHAR(15),
    confidence_level                NUMERIC(3,2),

    -- Evidence
    facts_from_source               JSONB,
    extracted_evidence              JSONB,
    evidence_snippets               JSONB,
    strategic_interpretation        JSONB,

    -- Executive output
    executive_summary_en            TEXT,
    executive_summary_es            TEXT,
    why_it_matters_en               TEXT,
    why_it_matters_es               TEXT,
    possible_impact_en  TEXT,
    possible_impact_es  TEXT,

    -- Review
    review_status                   VARCHAR(15) NOT NULL DEFAULT 'review',
    reviewer_notes                  TEXT,

    -- LLM audit trail
    llm_provider                    VARCHAR(50),
    llm_model                       VARCHAR(100),
    llm_prompt_version              VARCHAR(50),
    raw_llm_input                   TEXT,
    raw_llm_output                  TEXT,

    -- Timestamps
    processing_timestamp            TIMESTAMPTZ,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Deduplication
    content_hash                    VARCHAR(64) UNIQUE,

    -- CHECK constraints for enum-like fields
    CONSTRAINT chk_document_type CHECK (document_type IN (
        'paper', 'review', 'clinical_trial', 'preprint',
        'university_publication', 'journal_article', 'strategic_signal'
    )),
    CONSTRAINT chk_hype_risk CHECK (hype_risk IS NULL OR hype_risk IN ('low', 'medium', 'high')),
    CONSTRAINT chk_time_horizon CHECK (time_horizon IS NULL OR time_horizon IN ('immediate', 'short_term', 'medium_term', 'long_term')),
    CONSTRAINT chk_recommended_action CHECK (recommended_action IS NULL OR recommended_action IN (
        'monitor', 'investigate', 'test', 'discard'
    )),
    CONSTRAINT chk_review_status CHECK (review_status IN (
        'relevant', 'review', 'discarded', 'opportunity', 'follow_up'
    )),
    CONSTRAINT chk_confidence_level CHECK (confidence_level IS NULL OR (confidence_level >= 0 AND confidence_level <= 1)),
    CONSTRAINT chk_scientific_strength_score CHECK (scientific_strength_score IS NULL OR (scientific_strength_score >= 0 AND scientific_strength_score <= 10)),
    CONSTRAINT chk_strategic_relevance_score CHECK (strategic_relevance_score IS NULL OR (strategic_relevance_score >= 0 AND strategic_relevance_score <= 10))
);

COMMENT ON TABLE research_items IS 'Main table storing all ingested and classified research signals from scientific sources';
COMMENT ON COLUMN research_items.doi IS 'Digital Object Identifier for published papers';
COMMENT ON COLUMN research_items.pmid IS 'PubMed unique identifier';
COMMENT ON COLUMN research_items.nct_id IS 'ClinicalTrials.gov identifier (NCT number)';
COMMENT ON COLUMN research_items.arxiv_id IS 'arXiv preprint identifier';
COMMENT ON COLUMN research_items.normalized_title IS 'Lowercase, trimmed title for deduplication matching';
COMMENT ON COLUMN research_items.authors IS 'JSON array of author objects [{name, affiliation, orcid}]';
COMMENT ON COLUMN research_items.document_type IS 'Type of research document: paper, review, clinical_trial, preprint, university_publication, journal_article, strategic_signal';
COMMENT ON COLUMN research_items.thematic_tags IS 'JSON array of thematic classification tags assigned by LLM';
COMMENT ON COLUMN research_items.strategic_buckets IS 'JSON array of strategic bucket assignments: product_clinical, biomechanics, materials, ai_software, manufacturing_operations, research_partnerships, risk_disruption';
COMMENT ON COLUMN research_items.scientific_strength_score IS 'Score 0-10 evaluating scientific rigor and evidence quality';
COMMENT ON COLUMN research_items.strategic_relevance_score IS 'Score 0-10 evaluating strategic relevance to the organization's business';
COMMENT ON COLUMN research_items.hype_risk IS 'Risk of hype overinflation: low, medium, high';
COMMENT ON COLUMN research_items.time_horizon IS 'Expected time to practical applicability: immediate (0-6mo), short_term (6-18mo), medium_term (18-36mo), long_term (>36mo)';
COMMENT ON COLUMN research_items.recommended_action IS 'Suggested next step: monitor, investigate, test, discard';
COMMENT ON COLUMN research_items.confidence_level IS 'LLM confidence in its classification (0.00 to 1.00)';
COMMENT ON COLUMN research_items.review_status IS 'Human review status: relevant, review (pending), discarded, opportunity, follow_up';
COMMENT ON COLUMN research_items.content_hash IS 'SHA-256 hash of normalized content for deduplication';
COMMENT ON COLUMN research_items.raw_llm_input IS 'Complete prompt sent to LLM for audit and reproducibility';
COMMENT ON COLUMN research_items.raw_llm_output IS 'Complete raw response from LLM for audit and reproducibility';

-- =============================================================================
-- TABLE: configuration
-- Key-value configuration store for system parameters
-- =============================================================================
CREATE TABLE configuration (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category    VARCHAR(20) NOT NULL,
    key         VARCHAR(100) NOT NULL,
    value       JSONB NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_configuration_category_key UNIQUE (category, key),
    CONSTRAINT chk_config_category CHECK (category IN (
        'thematic', 'scoring', 'delivery', 'llm', 'general', 'sources'
    ))
);

COMMENT ON TABLE configuration IS 'System-wide key-value configuration store organized by category';
COMMENT ON COLUMN configuration.category IS 'Configuration domain: thematic, scoring, delivery, llm, general, sources';
COMMENT ON COLUMN configuration.value IS 'Configuration value as JSONB for flexible schema';

-- =============================================================================
-- TABLE: ingestion_runs
-- Audit trail recording each ingestion job execution
-- =============================================================================
CREATE TABLE ingestion_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    status          VARCHAR(15) NOT NULL DEFAULT 'running',
    items_fetched   INTEGER DEFAULT 0,
    items_new       INTEGER DEFAULT 0,
    items_duplicate INTEGER DEFAULT 0,
    items_processed INTEGER DEFAULT 0,
    errors          JSONB DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_run_status CHECK (status IN ('running', 'completed', 'failed')),
    CONSTRAINT chk_items_non_negative CHECK (
        items_fetched >= 0
        AND items_new >= 0
        AND items_duplicate >= 0
        AND items_processed >= 0
    )
);

COMMENT ON TABLE ingestion_runs IS 'Audit trail recording each ingestion job execution with statistics and error tracking';
COMMENT ON COLUMN ingestion_runs.items_fetched IS 'Total items retrieved from source';
COMMENT ON COLUMN ingestion_runs.items_new IS 'Items that were new (not previously seen)';
COMMENT ON COLUMN ingestion_runs.items_duplicate IS 'Items skipped as duplicates';
COMMENT ON COLUMN ingestion_runs.items_processed IS 'Items successfully processed through LLM pipeline';
COMMENT ON COLUMN ingestion_runs.errors IS 'JSON array of error objects [{message, item_id, timestamp}]';

-- =============================================================================
-- TABLE: daily_digests
-- Record of daily digest generation and delivery
-- =============================================================================
CREATE TABLE daily_digests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    digest_date      DATE NOT NULL,
    items_included   JSONB NOT NULL DEFAULT '[]'::jsonb,
    delivery_channel VARCHAR(10) NOT NULL,
    delivery_status  VARCHAR(15) NOT NULL DEFAULT 'pending',
    payload          JSONB,
    sent_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_delivery_channel CHECK (delivery_channel IN ('teams', 'email')),
    CONSTRAINT chk_delivery_status CHECK (delivery_status IN ('pending', 'sent', 'failed'))
);

COMMENT ON TABLE daily_digests IS 'Record of daily digest generation and delivery to stakeholders';
COMMENT ON COLUMN daily_digests.items_included IS 'JSON array of research_item UUIDs included in this digest';
COMMENT ON COLUMN daily_digests.payload IS 'Complete rendered payload sent to the delivery channel';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- sources indexes
CREATE INDEX idx_sources_enabled ON sources (enabled) WHERE enabled = TRUE;
CREATE INDEX idx_sources_category ON sources (category);
CREATE INDEX idx_sources_last_fetched ON sources (last_fetched_at);

-- research_items indexes - identification lookups
CREATE INDEX idx_research_items_doi ON research_items (doi) WHERE doi IS NOT NULL;
CREATE INDEX idx_research_items_pmid ON research_items (pmid) WHERE pmid IS NOT NULL;
CREATE INDEX idx_research_items_nct_id ON research_items (nct_id) WHERE nct_id IS NOT NULL;
CREATE INDEX idx_research_items_arxiv_id ON research_items (arxiv_id) WHERE arxiv_id IS NOT NULL;

-- research_items indexes - filtering and sorting
CREATE INDEX idx_research_items_source_id ON research_items (source_id);
CREATE INDEX idx_research_items_publication_date ON research_items (publication_date DESC);
CREATE INDEX idx_research_items_review_status ON research_items (review_status);
CREATE INDEX idx_research_items_document_type ON research_items (document_type);
CREATE INDEX idx_research_items_scientific_score ON research_items (scientific_strength_score DESC NULLS LAST);
CREATE INDEX idx_research_items_strategic_score ON research_items (strategic_relevance_score DESC NULLS LAST);
CREATE INDEX idx_research_items_recommended_action ON research_items (recommended_action) WHERE recommended_action IS NOT NULL;
CREATE INDEX idx_research_items_time_horizon ON research_items (time_horizon) WHERE time_horizon IS NOT NULL;
CREATE INDEX idx_research_items_created_at ON research_items (created_at DESC);
CREATE INDEX idx_research_items_processing_ts ON research_items (processing_timestamp DESC NULLS LAST);

-- research_items indexes - composite for common queries
CREATE INDEX idx_research_items_status_strategic ON research_items (review_status, strategic_relevance_score DESC NULLS LAST);
CREATE INDEX idx_research_items_status_date ON research_items (review_status, publication_date DESC);

-- research_items indexes - GIN indexes on JSONB arrays
CREATE INDEX idx_research_items_thematic_tags ON research_items USING GIN (thematic_tags jsonb_path_ops);
CREATE INDEX idx_research_items_strategic_buckets ON research_items USING GIN (strategic_buckets jsonb_path_ops);
CREATE INDEX idx_research_items_authors ON research_items USING GIN (authors jsonb_path_ops);

-- ingestion_runs indexes
CREATE INDEX idx_ingestion_runs_source_id ON ingestion_runs (source_id);
CREATE INDEX idx_ingestion_runs_status ON ingestion_runs (status);
CREATE INDEX idx_ingestion_runs_started_at ON ingestion_runs (started_at DESC);

-- daily_digests indexes
CREATE INDEX idx_daily_digests_date ON daily_digests (digest_date DESC);
CREATE INDEX idx_daily_digests_channel ON daily_digests (delivery_channel);
CREATE INDEX idx_daily_digests_status ON daily_digests (delivery_status);

-- configuration indexes
CREATE INDEX idx_configuration_category ON configuration (category);

-- =============================================================================
-- TRIGGERS: auto-update updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sources_updated_at
    BEFORE UPDATE ON sources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_research_items_updated_at
    BEFORE UPDATE ON research_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_configuration_updated_at
    BEFORE UPDATE ON configuration
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- SEED DATA: Default sources
-- =============================================================================
INSERT INTO sources (name, source_type, category, priority, enabled, base_url, config) VALUES
(
    'PubMed',
    'api',
    'core',
    1,
    TRUE,
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/',
    '{
        "search_endpoint": "esearch.fcgi",
        "fetch_endpoint": "efetch.fcgi",
        "db": "pubmed",
        "retmax": 100,
        "default_query": "(orthodontics OR aligners OR clear aligners OR malocclusion OR tooth movement) AND (\"last 7 days\"[dp])",
        "rate_limit_per_second": 3,
        "api_key_env": "PUBMED_API_KEY"
    }'::jsonb
),
(
    'arXiv',
    'api',
    'core',
    2,
    TRUE,
    'https://export.arxiv.org/api/',
    '{
        "search_endpoint": "query",
        "max_results": 50,
        "default_categories": ["cs.AI", "cs.CV", "cs.LG", "physics.med-ph", "q-bio.QM"],
        "default_query": "orthodontics OR dental alignment OR tooth segmentation OR cephalometric OR intraoral scan",
        "sort_by": "submittedDate",
        "sort_order": "descending"
    }'::jsonb
),
(
    'ClinicalTrials.gov',
    'api',
    'core',
    2,
    TRUE,
    'https://clinicaltrials.gov/api/v2/',
    '{
        "search_endpoint": "studies",
        "page_size": 50,
        "default_query": "orthodontics OR clear aligners OR malocclusion OR tooth movement OR dental biomechanics",
        "status_filter": ["RECRUITING", "NOT_YET_RECRUITING", "COMPLETED"],
        "fields": "NCTId,BriefTitle,OfficialTitle,BriefSummary,Condition,InterventionName,StudyType,OverallStatus,StartDate,CompletionDate,LeadSponsorName"
    }'::jsonb
),
(
    'Crossref',
    'api',
    'core',
    3,
    TRUE,
    'https://api.crossref.org/',
    '{
        "search_endpoint": "works",
        "rows": 50,
        "default_query": "orthodontics aligners biomechanics tooth movement",
        "filter": "from-pub-date:2024-01-01",
        "sort": "published",
        "order": "desc",
        "mailto_env": "CROSSREF_MAILTO"
    }'::jsonb
),
(
    'Semantic Scholar',
    'api',
    'core',
    3,
    TRUE,
    'https://api.semanticscholar.org/graph/v1/',
    '{
        "search_endpoint": "paper/search",
        "limit": 50,
        "default_query": "orthodontics clear aligners biomechanics AI dental",
        "fields": "title,abstract,authors,year,venue,externalIds,citationCount,influentialCitationCount,publicationDate,journal",
        "year_filter": "2024-",
        "api_key_env": "SEMANTIC_SCHOLAR_API_KEY"
    }'::jsonb
);

-- =============================================================================
-- SEED DATA: Default configuration - Thematic keywords
-- =============================================================================
INSERT INTO configuration (category, key, value, description) VALUES
(
    'thematic',
    'orthodontics_keywords',
    '{
        "primary": [
            "clear aligners", "invisible aligners", "orthodontic aligners",
            "tooth movement", "orthodontic treatment", "malocclusion",
            "dental alignment", "bite correction", "orthodontic biomechanics",
            "aligner therapy", "sequential aligners", "thermoplastic aligners"
        ],
        "materials": [
            "shape memory polymer", "thermoplastic polyurethane", "PETG",
            "aligner material", "dental polymer", "biocompatible polymer",
            "orthodontic wire", "NiTi", "nickel titanium",
            "3D printed aligner", "direct printed aligner"
        ],
        "digital_workflow": [
            "intraoral scanner", "digital impression", "CBCT",
            "cephalometric analysis", "treatment planning software",
            "digital orthodontics", "CAD/CAM dental", "STL dental",
            "tooth segmentation", "dental AI", "orthodontic AI"
        ],
        "clinical": [
            "root resorption", "attachment design", "aligner attachment",
            "interproximal reduction", "IPR", "staging protocol",
            "overcorrection", "refinement aligner", "retention",
            "Class II correction", "Class III correction", "open bite",
            "deep bite", "crossbite", "crowding", "spacing"
        ],
        "manufacturing": [
            "thermoforming", "direct 3D printing", "additive manufacturing dental",
            "dental 3D printing", "SLA dental", "DLP dental",
            "aligner production", "mass customization dental"
        ],
        "emerging": [
            "AI orthodontics", "machine learning dental", "deep learning dental",
            "computer vision dental", "automated treatment planning",
            "remote monitoring orthodontics", "dental telehealth",
            "bioprinting dental", "smart aligner", "sensor aligner"
        ]
    }'::jsonb,
    'Hierarchical keyword sets for orthodontics research classification'
),
(
    'thematic',
    'strategic_buckets',
    '{
        "buckets": [
            {
                "id": "product_clinical",
                "name": "Product & Clinical Evidence",
                "description": "Clinical outcomes, treatment efficacy, patient outcomes, comparative studies",
                "keywords": ["clinical trial", "treatment outcome", "efficacy", "patient satisfaction", "evidence-based"]
            },
            {
                "id": "biomechanics",
                "name": "Biomechanics & Tooth Movement",
                "description": "Force systems, tooth movement mechanics, finite element analysis, biological response",
                "keywords": ["biomechanics", "force system", "tooth movement", "FEA", "finite element", "PDL", "bone remodeling"]
            },
            {
                "id": "materials",
                "name": "Materials & Science",
                "description": "New materials, polymer science, material properties, degradation, biocompatibility",
                "keywords": ["material", "polymer", "biocompatible", "mechanical properties", "degradation", "thermoplastic"]
            },
            {
                "id": "ai_software",
                "name": "AI & Software",
                "description": "Artificial intelligence, machine learning, treatment planning algorithms, computer vision",
                "keywords": ["artificial intelligence", "machine learning", "deep learning", "neural network", "computer vision", "algorithm"]
            },
            {
                "id": "manufacturing_operations",
                "name": "Manufacturing & Operations",
                "description": "Production processes, 3D printing, thermoforming, quality control, supply chain",
                "keywords": ["manufacturing", "3D printing", "thermoforming", "additive manufacturing", "quality control", "production"]
            },
            {
                "id": "research_partnerships",
                "name": "Research Partnerships & University",
                "description": "Academic collaborations, university research, grants, partnerships",
                "keywords": ["university", "research group", "collaboration", "grant", "partnership", "academic"]
            },
            {
                "id": "risk_disruption",
                "name": "Risk & Disruption",
                "description": "Disruptive technologies, competitive threats, regulatory changes, market shifts",
                "keywords": ["disruption", "breakthrough", "paradigm shift", "regulatory", "patent", "competitor"]
            }
        ]
    }'::jsonb,
    'Strategic bucket definitions for classifying research relevance to business areas'
);

-- =============================================================================
-- SEED DATA: Default configuration - Scoring weights
-- =============================================================================
INSERT INTO configuration (category, key, value, description) VALUES
(
    'scoring',
    'strategic_relevance_weights',
    '{
        "weights": {
            "proximity_to_aligners": 0.25,
            "impact": 0.20,
            "evidence_quality": 0.15,
            "time_to_applicability": 0.15,
            "novelty": 0.10,
            "competitive_advantage": 0.10,
            "strategic_priority_affinity": 0.05
        },
        "score_range": {"min": 0, "max": 10},
        "thresholds": {
            "high_relevance": 7.0,
            "medium_relevance": 4.0,
            "low_relevance": 0.0
        }
    }'::jsonb,
    'Weighted scoring formula for strategic relevance calculation. Weights must sum to 1.0.'
),
(
    'scoring',
    'scientific_strength_criteria',
    '{
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
                    "preprint_no_review": 1
                }
            },
            "sample_size": {
                "weight": 0.20,
                "levels": {
                    "large_n_gt_100": 10,
                    "medium_n_30_100": 7,
                    "small_n_10_30": 4,
                    "very_small_n_lt_10": 2,
                    "not_applicable": 5
                }
            },
            "journal_impact": {
                "weight": 0.20,
                "levels": {
                    "top_tier_if_gt_5": 10,
                    "high_if_3_5": 8,
                    "medium_if_1_3": 5,
                    "low_if_lt_1": 3,
                    "preprint_no_journal": 1
                }
            },
            "methodology_rigor": {
                "weight": 0.15,
                "description": "LLM assessment of methodological quality"
            },
            "recency": {
                "weight": 0.15,
                "levels": {
                    "last_3_months": 10,
                    "last_6_months": 8,
                    "last_year": 6,
                    "last_2_years": 4,
                    "older": 2
                }
            }
        }
    }'::jsonb,
    'Criteria and weights for evaluating scientific strength of research items'
);

-- =============================================================================
-- SEED DATA: Default configuration - Delivery settings
--
-- Only what belongs to a deployment: when the digest runs, and where it is
-- sent. The score threshold, the item count and the sections are domain
-- judgements and live in the Radar Profile (`delivery`); the output language
-- is declared once, by the profile's `summary.languages`.
-- =============================================================================
INSERT INTO configuration (category, key, value, description) VALUES
(
    'delivery',
    'daily_digest_settings',
    '{
        "digest_schedule": "09:00",
        "digest_timezone": "Europe/Madrid",
        "teams_webhook_env": "TEAMS_WEBHOOK_URL",
        "email_recipients_env": "DIGEST_EMAIL_RECIPIENTS"
    }'::jsonb,
    'Daily digest delivery: schedule and where to send it. Domain thresholds live in the Radar Profile'
);

-- =============================================================================
-- SEED DATA: Default configuration - LLM settings
-- =============================================================================
INSERT INTO configuration (category, key, value, description) VALUES
(
    'llm',
    'classification_settings',
    '{
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
        "rate_limit_rpm": 50
    }'::jsonb,
    'LLM provider and model configuration for research item classification'
);

-- =============================================================================
-- SEED DATA: Default configuration - General settings
-- =============================================================================
INSERT INTO configuration (category, key, value, description) VALUES
(
    'general',
    'system_settings',
    '{
        "project_name": "Frontier Radar",
        "version": "1.0.0",
        "dedup_strategy": "content_hash",
        "normalized_title_match_threshold": 0.92,
        "max_abstract_length": 10000,
        "default_lookback_days": 7,
        "enabled_document_types": [
            "paper", "review", "clinical_trial", "preprint",
            "university_publication", "journal_article", "strategic_signal"
        ]
    }'::jsonb,
    'General system-wide settings for the Frontier Radar'
),
(
    'general',
    'review_status_definitions',
    '{
        "relevant": "Confirmed relevant to the organization strategic interests, included in reporting",
        "review": "Pending human review, default status for newly ingested items",
        "discarded": "Reviewed and determined not relevant, excluded from reporting",
        "opportunity": "Identified as a concrete business or research opportunity",
        "follow_up": "Requires additional investigation or monitoring over time"
    }'::jsonb,
    'Definitions of each review status for documentation and UI display'
);

-- =============================================================================
-- SEED DATA: Default configuration - Source-specific settings
-- =============================================================================
INSERT INTO configuration (category, key, value, description) VALUES
(
    'sources',
    'ingestion_schedule',
    '{
        "default_interval_hours": 24,
        "core_sources_interval_hours": 12,
        "university_sources_interval_hours": 168,
        "max_concurrent_fetches": 3,
        "global_timeout_seconds": 300,
        "retry_failed_after_hours": 6
    }'::jsonb,
    'Scheduling configuration for source ingestion jobs'
);
