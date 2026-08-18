/**
 * Source types - aligned with backend schemas (source.py)
 */

export interface Source {
  id: string;
  name: string;
  source_type: string;
  category: string;
  priority: number;
  enabled: boolean;
  config: Record<string, unknown>;
  base_url: string | null;
  last_fetched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceUpdatePayload {
  enabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
  base_url?: string;
  query_terms?: string[];
  max_results?: number;
}
