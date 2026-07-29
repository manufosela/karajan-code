/**
 * Configuration types - aligned with backend schemas (configuration.py)
 */

export type ConfigCategory = "thematic" | "scoring" | "delivery" | "llm" | "general" | "sources";

export interface Configuration {
  id: string;
  category: string;
  key: string;
  value: Record<string, unknown>;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type ConfigValue = Record<string, unknown>;

export interface ConfigurationUpdatePayload {
  value: ConfigValue;
}
