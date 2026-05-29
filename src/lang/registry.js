// KJC-PCS-0052 PR-A — Language adapter registry. Antes vivían CODE_EXT_RE
// y SKIP_SEGMENTS hardcoded en indexer.js (solo JS/TS); ahora cada adapter
// declara extensiones, skipSegments y manifests. PR-B añadirá AST chunkers
// (tree-sitter); PR-C/D usan el mismo registry para audit y onboarder.
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import { JS_ADAPTER } from "./js.js";
import { PYTHON_ADAPTER } from "./python.js";

// Segmentos siempre excluidos del walk, independientes de stack: VCS,
// outputs de build, scratch de Karajan, sandbox del audit. Lo que viva
// aquí jamás se indexa.
const COMMON_SKIP_SEGMENTS = [".git", "dist", "build", "coverage", ".karajan", ".kj", "_diet"];

const REGISTRY = [JS_ADAPTER, PYTHON_ADAPTER];

export function getAdapters() {
  return REGISTRY.slice();
}

/**
 * Detecta qué adapters aplican a un projectDir mirando los manifests
 * declarados. Si ningún adapter coincide (proyecto sin manifest), cae
 * a JS para no romper repos legacy o sandboxes de tests.
 */
export function detectAdaptersForProject(projectDir) {
  if (!projectDir) return [JS_ADAPTER];
  const matched = REGISTRY.filter((a) => a.manifests.some((m) => existsSync(join(projectDir, m))));
  return matched.length ? matched : [JS_ADAPTER];
}

/**
 * Construye los matchers que usa el indexer al recorrer el árbol:
 * `isCodeFile(path)` decide si la extensión cuadra con algún adapter
 * activo; `shouldSkip(path)` aplica la unión de skipSegments comunes +
 * los del adapter. Devuelve también `extensions` por si el caller quiere
 * inspeccionarlas (p.ej. tests).
 */
export function buildMatchers(adapters) {
  const extSet = new Set();
  const skipSet = new Set(COMMON_SKIP_SEGMENTS);
  for (const a of adapters) {
    for (const e of a.extensions) extSet.add(e.toLowerCase());
    for (const s of a.skipSegments || []) skipSet.add(s);
  }
  return {
    isCodeFile: (p) => extSet.has(extname(p).toLowerCase()),
    shouldSkip: (p) => p.split("/").some((seg) => skipSet.has(seg)),
    extensions: [...extSet],
  };
}

/**
 * Unión de extensiones de TODOS los adapters registrados. Útil para
 * `detectKind` en el indexer, que recibe un path suelto sin saber el
 * projectDir y necesita reconocer una extensión de código aunque venga
 * de un adapter no detectado en el proyecto actual.
 */
export function getAllCodeExtensions() {
  const out = new Set();
  for (const a of REGISTRY) for (const e of a.extensions) out.add(e.toLowerCase());
  return [...out];
}
