/* ─── Analytics API response types ───────────────────────── */

export interface TrendDataPoint {
  date: string;
  count: number;
}

export interface TrendSourceData {
  source_id: string;
  source_name: string;
  data: TrendDataPoint[];
}

export interface AnalyticsTrendsResponse {
  period: string;
  total: number;
  by_source: TrendSourceData[];
}

export interface ScoreBucketEntry {
  bucket: string;
  count: number;
}

export interface AnalyticsScoresResponse {
  scientific: ScoreBucketEntry[];
  strategic: ScoreBucketEntry[];
  avg_scientific: number;
  avg_strategic: number;
  by_bucket: Record<string, number>;
  by_hype_risk: Record<string, number>;
  by_recommended_action: Record<string, number>;
}

export interface IngestionRun {
  id: string;
  source_name: string;
  started_at: string;
  status: string;
  items_fetched: number;
  items_new: number;
  items_duplicate: number;
  duration_seconds: number;
}

export interface SourceHealth {
  source_id: string;
  source_name: string;
  last_fetch: string | null;
  total_runs: number;
  error_count: number;
  is_healthy: boolean;
}

export interface AnalyticsIngestionResponse {
  recent_runs: IngestionRun[];
  sources_health: SourceHealth[];
  total_processed_24h: number;
  total_errors_24h: number;
}

/* ─── Cost Estimate types ────────────────────────────────── */

export interface CostLineItem {
  label: string;
  amount: number;
  note: string | null;
}

export interface CostEstimateResponse {
  period: string;
  line_items: CostLineItem[];
  total_estimated: number;
  currency: string;
  signals_processed: number;
  ingestion_runs: number;
  last_updated: string;
}
