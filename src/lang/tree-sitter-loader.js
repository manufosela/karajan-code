// KJC-PCS-0052 PR-B.2.1 — Lazy loader for web-tree-sitter parsers.
// Async init (Parser.init + Language.load) is paid once per language id
// and cached. Callers that want AST chunking must `await loadLanguage(...)`
// during pre-loop; the per-file chunker then reads the cached entry
// synchronously via `getLoaded(id)` and falls back to regex if not ready.
//
// Pure WASM (web-tree-sitter) over native bindings: no node-gyp build, no
// per-platform .node files — works inside the SEA binary because the
// grammar `.wasm` files travel with the npm package under
// `vendor/tree-sitter-grammars/` (see ../../vendor/.../README.md).
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Language, Parser } from "web-tree-sitter";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_DIR = resolve(HERE, "../../vendor/tree-sitter-grammars");

const cache = new Map();
let runtimePromise = null;

async function initRuntime() {
  if (!runtimePromise) runtimePromise = Parser.init();
  return runtimePromise;
}

export function grammarPath(id) {
  return resolve(GRAMMAR_DIR, `${id}.wasm`);
}

export async function loadLanguage(id, wasmPath = grammarPath(id)) {
  if (cache.has(id)) return cache.get(id);
  await initRuntime();
  const language = await Language.load(wasmPath);
  const parser = new Parser();
  parser.setLanguage(language);
  const entry = { parser, language };
  cache.set(id, entry);
  return entry;
}

export function getLoaded(id) {
  return cache.get(id) || null;
}

export function resetForTests() {
  cache.clear();
  runtimePromise = null;
}
