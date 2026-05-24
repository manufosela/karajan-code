// KJC-TSK-0437 — `kj doctor` check for the RAG embedder.
// Only fires when rag.preload.enabled === true; otherwise reports
// "Disabled in config" so doctor stays quiet on greenfield projects
// that never opted in to RAG.
import { isOllamaReachable } from "../rag/ollama-manager.js";
import { STRATEGY } from "./types.js";

function ragEnabled(config) {
  return config?.rag?.preload?.enabled === true;
}
function ollamaHost(config) {
  const port = config?.rag?.embedder?.port || 11434;
  return config?.rag?.embedder?.host || `http://localhost:${port}`;
}

function createOllamaStatusCheck() {
  return {
    name: "ollama",
    label: "Ollama (RAG embedder)",
    strategy: STRATEGY.NONE,
    async detect({ config }) {
      if (!ragEnabled(config)) {
        return { ok: true, severity: "info", detail: "Disabled in config (rag.preload.enabled=false)" };
      }
      const host = ollamaHost(config);
      let reachable;
      try { reachable = await isOllamaReachable(host); } catch { reachable = false; }
      return {
        ok: reachable,
        severity: reachable ? "info" : "warn",
        detail: reachable ? `Reachable at ${host}` : `Not reachable at ${host}`,
        fix: reachable ? undefined : "Run `kj ollama start` to bootstrap the container, or `kj init --no-ollama` to opt out.",
        extra: { host, reachable },
      };
    },
  };
}

export function getOllamaChecks() {
  return [createOllamaStatusCheck()];
}
