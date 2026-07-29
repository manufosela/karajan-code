/**
 * Signal types - aligned with backend schemas (signals.py, research_item.py)
 * Backend source: app/schemas/signals.py
 */

export type ReviewStatus = "pending" | "relevant" | "review" | "discarded" | "opportunity" | "follow_up";

export type DocumentType = string; // Backend uses free-form string

export type HypeRisk = "low" | "medium" | "high" | "very_high";

export type TimeHorizon = "immediate" | "short_term" | "medium_term" | "long_term" | "speculative";

export type RecommendedAction =
  | "adopt_now"
  | "start_pilot"
  | "deep_evaluation"
  | "monitor_closely"
  | "periodic_review"
  | "archive"
  | "partner_search"
  | "internal_rd";

/**
 * Signal list item - matches backend SignalListResponse
 */
export interface Signal {
  id: string;
  source_id: string;
  original_title: string;
  doi: string | null;
  publication_date: string | null;
  document_type: string;
  journal_or_origin: string | null;
  thematic_tags: string[];
  strategic_buckets: string[];
  scientific_strength_score: number | null;
  strategic_relevance_score: number | null;
  hype_risk: HypeRisk | null;
  time_horizon: TimeHorizon | null;
  recommended_action: RecommendedAction | null;
  review_status: ReviewStatus;
  reviewer_notes: string | null;
  executive_summary_en: string | null;
  executive_summary_es: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Signal detail - matches backend SignalDetailResponse
 */
export interface SignalDetail extends Signal {
  pmid: string | null;
  nct_id: string | null;
  arxiv_id: string | null;
  original_url: string | null;
  normalized_title: string | null;
  authors: Array<Record<string, unknown>>;
  abstract: string | null;
  language: string | null;
  scientific_strength_reasons: Record<string, unknown> | null;
  strategic_relevance_reasons: Record<string, unknown> | null;
  confidence_level: number | null;
  facts_from_source: Record<string, unknown> | null;
  extracted_evidence: Record<string, unknown> | null;
  evidence_snippets: Record<string, unknown> | null;
  strategic_interpretation: Record<string, unknown> | null;
  why_it_matters_en: string | null;
  why_it_matters_es: string | null;
  possible_impact_for_geniova_en: string | null;
  possible_impact_for_geniova_es: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  llm_prompt_version: string | null;
  raw_llm_input: string | null;
  raw_llm_output: string | null;
  processing_timestamp: string | null;
  content_hash: string | null;
}

export interface SignalFilters {
  search?: string;
  review_status?: string;
  document_type?: string;
  source_id?: string;
  theme?: string;
  bucket?: string;
  hype_risk?: string;
  recommended_action?: string;
  min_scientific_score?: number;
  min_strategic_score?: number;
  date_from?: string;
  date_to?: string;
}

export interface PaginationParams {
  page: number;
  page_size: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface BackendPaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface SignalReviewResponse {
  id: string;
  review_status: string;
  reviewer_notes: string | null;
  updated_at: string;
}

export interface ResearchItemStats {
  total_count: number;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  by_bucket: Record<string, number>;
  by_document_type: Record<string, number>;
  avg_scientific_score: number | null;
  avg_strategic_score: number | null;
}
