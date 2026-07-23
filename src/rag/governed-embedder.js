/**
 * Governed embedder (KJC-TSK-0682 — card filed by the karajan-rag session
 * after its independent security audit closed the same risk there, H2).
 * Chunks of project code must not travel to a cloud embedder without
 * governance: local providers (ollama/onnx) pass through untouched; cloud
 * providers (openai/voyage/cohere/mistral) require an EXPLICIT
 * `rag.sensitivity: public` — the default (`internal`) blocks with an
 * actionable error, never a silent downgrade. Even when allowed, every
 * text is PII-redacted (karajan-rag's audited redactPII) before leaving
 * the machine — defense in depth, not a substitute for the policy.
 */
import { redactPII } from "karajan-rag";
import { makeEmbedder } from "./embedders/factory.js";

const LOCAL_PROVIDERS = new Set(["ollama", "onnx"]);
const redact = (text) => redactPII(String(text)).text;

class RedactingEmbedder {
  constructor(inner) { this.inner = inner; }
  get dim() { return this.inner.dim; }
  get model() { return this.inner.model; }
  async embed(text) { return this.inner.embed(redact(text)); }
  async embedBatch(texts) { return this.inner.embedBatch(texts.map(redact)); }
}

/** Drop-in replacement for makeEmbedder(config) at every kj call site. */
export function makeGovernedEmbedder(config) {
  const provider = config?.rag?.embedder?.provider || "ollama";
  if (LOCAL_PROVIDERS.has(provider)) return makeEmbedder(config);

  const sensitivity = config?.rag?.sensitivity || "internal";
  if (sensitivity !== "public") {
    throw new Error(
      `embedder "${provider}" sends your code to a cloud provider, but rag.sensitivity is "${sensitivity}". `
      + `Use a local embedder (rag.embedder.provider: ollama | onnx) or declare rag.sensitivity: public in kj.config.yml.`
    );
  }
  return new RedactingEmbedder(makeEmbedder(config));
}
