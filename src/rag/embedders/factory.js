// KJC-TSK-0442 / KJC-TSK-0446 — Embedder factory. Selects provider from
// config.rag.embedder.provider (ollama | openai | voyage | cohere | mistral;
// default ollama). Each provider has its own dim default; the factory wires
// it so the caller does not need to know.
import { OllamaEmbedder } from "../embedder.js";
import { OpenAIEmbedder } from "./openai.js";
import { VoyageEmbedder } from "./voyage.js";
import { CohereEmbedder } from "./cohere.js";
import { MistralEmbedder } from "./mistral.js";

const PROVIDERS = {
  ollama: { cls: OllamaEmbedder, dim: 768 },
  openai: { cls: OpenAIEmbedder, dim: 1536 },
  voyage: { cls: VoyageEmbedder, dim: 1024 },
  cohere: { cls: CohereEmbedder, dim: 1024 },
  mistral: { cls: MistralEmbedder, dim: 1024 },
};

export function makeEmbedder(config = {}) {
  const cfg = config?.rag?.embedder || {};
  const provider = cfg.provider || "ollama";
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`Unknown embedder provider: ${provider}. Supported: ${Object.keys(PROVIDERS).join(", ")}`);
  const dim = cfg.dim || spec.dim;
  return new spec.cls({ url: cfg.url, apiKey: cfg.api_key, model: cfg.model, dim, timeoutMs: cfg.timeout_ms });
}

export { PROVIDERS };
