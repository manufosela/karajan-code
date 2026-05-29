// KJC-PCS-0052 PR-A — JS/TS adapter. Codifica las constantes que vivían
// hard-coded en src/rag/indexer.js antes del registry.
export const JS_ADAPTER = {
  id: "js",
  extensions: [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
  skipSegments: ["node_modules", ".next", ".nuxt", ".svelte-kit"],
  manifests: ["package.json"],
};
