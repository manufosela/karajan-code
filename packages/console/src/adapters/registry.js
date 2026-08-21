// C0 (KJC-TSK-0776, ADR 0007) — operations are generic; providers are
// adapters. An adapter declares only the capabilities it implements; asking
// for one it lacks is an error at wiring time, never a surprise at runtime.
export const CAPABILITIES = ["health", "listAccess", "grant", "revoke", "dispatch", "runStatus", "runLog", "secretWrite", "proposeConfigChange"];

export function createRegistry(adapters = {}) {
  const get = (name) => {
    const a = adapters[name];
    if (!a) throw new Error(`adapter "${name}" is not registered in this build (registered: ${Object.keys(adapters).join(", ") || "none"})`);
    return a;
  };
  const demand = (name, capability) => {
    if (!CAPABILITIES.includes(capability)) throw new TypeError(`unknown capability "${capability}" (${CAPABILITIES.join(", ")})`);
    const a = get(name);
    if (typeof a[capability] !== "function") throw new Error(`adapter "${name}" has no capability "${capability}"`);
    return a;
  };
  /** Adapter names the config relies on that this build does not register. */
  const missingFor = (config) => {
    const wanted = new Set([...config.corpora, ...config.operations, ...config.secrets, ...(config.configRepo ? [config.configRepo] : [])].map((x) => x.adapter));
    return [...wanted].filter((n) => !adapters[n]);
  };
  return { get, demand, missingFor, names: () => Object.keys(adapters) };
}

/** In-memory adapter for tests and dry runs: access lists and dispatches live in a Map. */
export function memoryAdapter() {
  const access = new Map();
  const runs = [];
  const list = (corpus) => access.get(corpus.id) ?? access.set(corpus.id, new Set()).get(corpus.id);
  return {
    name: "memory",
    health: async (corpus) => ({ ok: true, corpus: corpus.id, fingerprint: "memory", files: 0, chunks: 0 }),
    listAccess: async (corpus) => [...list(corpus)],
    grant: async (corpus, principal) => { list(corpus).add(principal); return { granted: principal }; },
    revoke: async (corpus, principal) => ({ revoked: list(corpus).delete(principal) }),
    dispatch: async (operation, inputs = {}) => { runs.push({ operation: operation.id, inputs }); return { runRef: `memory:${runs.length}` }; },
    runStatus: async (runRef) => ({ runRef, status: "completed", conclusion: "success" }),
    runLog: async (runRef) => `run ${runRef}: ok`,
    _runs: runs,
  };
}
