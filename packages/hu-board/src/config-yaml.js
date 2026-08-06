/**
 * Read / write the global Karajan config (~/.karajan/kj.config.yml)
 * from the board.
 *
 * The board is a Node Express server that the user already has
 * running, so it's the natural place to expose a "settings" page —
 * no extra terminal trip, no risk of malformed YAML, plain Spanish
 * labels for non-technical users.
 *
 * Design notes:
 *
 * - The yml may contain dozens of fields (legacy, advanced, future
 *   experiments). The board only EXPOSES + EDITS a small whitelist
 *   that maps to the labels the UI shows. Everything else is read,
 *   preserved verbatim, and written back unchanged. So a power
 *   user editing the file by hand never loses keys when they later
 *   touch the modal.
 *
 * - Writes go through a tmp-file + atomic rename so a partial
 *   write never leaves the user with a corrupt yml.
 *
 * - A `.bak` copy is kept of the previous content so the user can
 *   recover from a botched save outside the modal (rare but
 *   irrecoverable otherwise).
 *
 * - VITEST aware: when KJ_HOME is set we honour it (every test
 *   harness uses tmp dirs already). When not set we use
 *   `~/.karajan/kj.config.yml` like the rest of Karajan does.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import yaml from 'js-yaml';
import { getKjHome } from './db.js';

/**
 * v2.30.0 PR4 — scope resolver.
 *
 *   'global'  → ~/.karajan/kj.config.yml (mismo path que el resto de
 *               Karajan; afecta a todos los proyectos).
 *   'project' → <projectDir>/.karajan/kj.config.yml (override por
 *               proyecto; cuando existe, el loader del padre lo prefiere
 *               sobre el global).
 *
 * projectDir se resuelve desde `KJ_PROJECT_DIR` (ya usado por
 * journal-parser.js) con fallback a `process.cwd()` — el board se
 * arranca desde el repo del usuario, así que cwd es el proyecto.
 */
export const SCOPES = ['global', 'project'];

function getProjectDir() {
  return process.env.KJ_PROJECT_DIR || process.cwd();
}

function configPath(scope = 'global') {
  if (scope === 'project') {
    return join(getProjectDir(), '.karajan', 'kj.config.yml');
  }
  // Same path the parent uses (src/utils/paths.js::getKarajanHome).
  // KJC-TSK-0420: delegate to db.js::getKjHome — gives us KARAJAN_HOME
  // priority + KJ_HOME fallback + VITEST guard from one place, instead
  // of duplicating the precedence here.
  return join(getKjHome(), 'kj.config.yml');
}

function backupPath(scope = 'global') { return `${configPath(scope)}.bak`; }

/**
 * v2.30.0 — Categorías para agrupar los campos en el modal. El backend
 * sólo declara la metadata (id, label, icon, order). El front (app.js)
 * itera sobre EDITABLE_FIELDS, agrupa por `f.category` y dibuja un
 * <h3> por sección. Si un campo nuevo no declara categoría, cae en
 * "Otros" (defensivo: no se pierde aunque se nos olvide etiquetarlo).
 */
export const CATEGORIES = [
  { id: 'agents',   label: 'Agentes y modelos',        icon: '🤖', order: 1 },
  { id: 'pipeline', label: 'Roles del pipeline',       icon: '🔌', order: 2 },
  { id: 'rag',      label: 'RAG (búsqueda de contexto)', icon: '📚', order: 3 },
  { id: 'session',  label: 'Tiempos de sesión',        icon: '⏱',  order: 4 },
  { id: 'quality',  label: 'Calidad',                  icon: '✅', order: 5 },
  // KJC-PRP-0002 PR5: team-shared HU board controls. Today only carries
  // the conflict-resolution policy when a planId lives in both
  // ~/.karajan/plans/ (per-user) and <projectDir>/.karajan-shared/plans/
  // (team-committed). Will grow as more board-level multi-user knobs land.
  { id: 'huBoard',  label: 'HU Board (equipo)',        icon: '🔗', order: 6 },
];

/**
 * Whitelist of fields the board's modal exposes. Everything else
 * stays untouched in the yml. Each entry says where in the yml the
 * field lives (`path`) and how to render it for the UI (`type`,
 * `label`, `options` for selects, `category` for grouping).
 *
 * The path is a dotted notation we resolve manually (so we never
 * need to take a runtime dep on lodash for `_.get`/`_.set`).
 */
export const EDITABLE_FIELDS = [
  {
    key: 'coder',
    path: 'coder',
    category: 'agents',
    type: 'select',
    label: 'Agente para el rol "coder"',
    help: 'Quién escribe el código. Claude es el más fiable, Codex es más rápido.',
    options: ['claude', 'codex', 'gemini', 'aider'],
    default: 'claude',
  },
  {
    key: 'reviewer',
    path: 'reviewer',
    category: 'agents',
    type: 'select',
    label: 'Agente para el rol "reviewer"',
    help: 'Quién revisa el código del coder. Conviene que sea un agente distinto al coder para detectar errores.',
    options: ['claude', 'codex', 'gemini', 'aider'],
    default: 'codex',
  },
  {
    key: 'modelMode',
    path: '_modelMode_virtual',
    category: 'agents',
    type: 'select',
    label: 'Estrategia de modelos',
    help: 'Auto = Karajan elige el modelo según la complejidad (haiku/sonnet/opus). Sonnet siempre = barato, ideal para pruebas. Opus siempre = caro, máxima calidad.',
    options: ['auto', 'sonnet', 'opus'],
    default: 'auto',
    // Virtual field: doesn't map 1:1 to a yml key. Translate when
    // reading + writing (see readConfig + writeConfigPatch).
  },
  {
    key: 'maxIterationMinutes',
    path: 'session.max_iteration_minutes',
    category: 'session',
    type: 'number',
    label: 'Tope de minutos por iteración',
    help: 'Si una iteración (coder + reviewer) supera este tiempo, Karajan la corta y Solomon decide qué hacer.',
    min: 1,
    max: 120,
    default: 30,
  },
  {
    key: 'maxTotalMinutes',
    path: 'session.max_total_minutes',
    category: 'session',
    type: 'number',
    label: 'Tope de minutos total por sesión',
    help: 'Tope absoluto del wall-clock de la sesión. Si se llega aquí, Karajan para aunque queden HUs.',
    min: 5,
    max: 480,
    default: 120,
  },
  {
    key: 'sonarEnabled',
    path: 'sonarqube.enabled',
    category: 'quality',
    type: 'boolean',
    label: 'Activar análisis SonarQube',
    help: 'Pasa el código por SonarQube y bloquea si el quality gate falla. Requiere SonarQube corriendo.',
    default: false,
  },
  // v2.30.0 — pipeline role toggles. Cada uno controla si una etapa
  // del pipeline se ejecuta. Brain está OFF por defecto porque sigue
  // siendo opt-in (v2 feature); el resto reflejan los defaults de
  // src/config/defaults.js.
  {
    key: 'plannerEnabled',
    path: 'pipeline.planner.enabled',
    category: 'pipeline',
    type: 'boolean',
    label: 'Activar rol planner',
    help: 'Genera un plan de implementación antes de codificar. Útil en tareas con >2 archivos o devPoints ≥ 3.',
    default: true,
  },
  {
    key: 'researcherEnabled',
    path: 'pipeline.researcher.enabled',
    category: 'pipeline',
    type: 'boolean',
    label: 'Activar rol researcher',
    help: 'Investiga la codebase antes del coder (lectura de archivos clave, patrones existentes).',
    default: true,
  },
  {
    key: 'architectEnabled',
    path: 'pipeline.architect.enabled',
    category: 'pipeline',
    type: 'boolean',
    label: 'Activar rol architect',
    help: 'Diseña la arquitectura (capas, patrones, contratos) antes de codificar. Recomendado en cambios estructurales.',
    default: true,
  },
  {
    key: 'testerEnabled',
    path: 'pipeline.tester.enabled',
    category: 'pipeline',
    type: 'boolean',
    label: 'Activar rol tester',
    help: 'Genera tests automáticos durante o después del coder. Refuerza la calidad.',
    default: true,
  },
  {
    key: 'securityEnabled',
    path: 'pipeline.security.enabled',
    category: 'pipeline',
    type: 'boolean',
    label: 'Activar rol security',
    help: 'Audita el código contra OWASP-style issues, secret leaks, dependencias vulnerables.',
    default: true,
  },
  {
    key: 'refactorerEnabled',
    path: 'pipeline.refactorer.enabled',
    category: 'pipeline',
    type: 'boolean',
    label: 'Activar rol refactorer',
    help: 'Pasa una iteración de limpieza tras el coder (extract function, rename, etc.).',
    default: false,
  },
  {
    key: 'impeccableEnabled',
    path: 'pipeline.impeccable.enabled',
    category: 'pipeline',
    type: 'boolean',
    label: 'Activar rol impeccable',
    help: 'Auditoría UI/UX automática (Lighthouse, a11y, contraste). Solo útil en frontend.',
    default: false,
  },
  {
    key: 'brainEnabled',
    path: 'pipeline.brain.enabled',
    category: 'pipeline',
    type: 'boolean',
    label: 'Activar Karajan Brain (v2)',
    help: 'Orquestador IA central: enriquece feedback, comprime outputs y verifica cambios reales. Opt-in.',
    default: false,
  },
  // v2.30.0 — RAG controls. Cubren los tres ejes que afectan al
  // retrieval en tiempo de pipeline: pre-carga (rag.preload.*),
  // proveedor de embeddings (rag.embedder.provider) y parámetros de
  // búsqueda (rag.search.*, cableados al stage en KJC-TSK-0463).
  {
    key: 'ragPreloadEnabled',
    path: 'rag.preload.enabled',
    category: 'rag',
    type: 'boolean',
    label: 'Activar pre-carga RAG en el pipeline',
    help: 'Si está activo, antes de cada iteración se inyecta contexto del vector store en el prompt del coder.',
    default: false,
  },
  {
    key: 'ragPreloadTopK',
    path: 'rag.preload.topK',
    category: 'rag',
    type: 'number',
    label: 'Nº de chunks a pre-cargar (topK)',
    help: 'Cuántos fragmentos del vector store se inyectan como contexto. 3-5 funciona bien; subir gasta tokens.',
    min: 1,
    max: 20,
    default: 5,
  },
  {
    key: 'ragPreloadScope',
    path: 'rag.preload.scope',
    category: 'rag',
    type: 'select',
    label: 'Scope de la pre-carga RAG',
    help: '"all" mezcla todo. "code" solo busca en el código indexado, "plans" en planes previos, "onboarding" en el brief del proyecto.',
    options: ['all', 'code', 'plans', 'onboarding'],
    default: 'all',
  },
  {
    key: 'ragEmbedderProvider',
    path: 'rag.embedder.provider',
    category: 'rag',
    type: 'select',
    label: 'Proveedor de embeddings RAG',
    help: 'Ollama local es gratis. OpenAI/Voyage/Cohere/Mistral son cloud (requieren API key). ONNX corre 100% local con @huggingface/transformers.',
    options: ['ollama', 'openai', 'voyage', 'cohere', 'mistral', 'onnx'],
    default: 'ollama',
  },
  // KJC-TSK-0463 — search-time knobs ahora cableados al stage.
  // mode/alpha controlan el fuse semantic vs keyword; rerank activa el
  // cross-encoder opcional (más calidad, más latencia).
  {
    key: 'ragSearchMode',
    path: 'rag.search.mode',
    category: 'rag',
    type: 'select',
    label: 'Modo de búsqueda RAG',
    help: '"hybrid" mezcla semántico + BM25 (recomendado). "semantic" sólo embeddings. "keyword" sólo BM25 (útil si los embeddings están desafinados).',
    options: ['hybrid', 'semantic', 'keyword'],
    default: 'hybrid',
  },
  {
    key: 'ragSearchAlpha',
    path: 'rag.search.alpha',
    category: 'rag',
    type: 'number',
    label: 'Alpha del modo hybrid (0-1)',
    help: 'Peso del scoring semántico vs keyword en modo hybrid. 1.0 = sólo semántico, 0.0 = sólo BM25, 0.6 (default) = inclinado a semántico.',
    min: 0,
    max: 1,
    // KJC-BUG-0069 — number input defaults to step=1 (HTML5), so any
    // non-integer default fails validity. Allow any fractional value here.
    step: 'any',
    default: 0.6,
  },
  {
    key: 'ragSearchRerank',
    path: 'rag.search.rerank',
    category: 'rag',
    type: 'boolean',
    label: 'Activar rerank cross-encoder',
    help: 'Re-puntúa los topK supervivientes con un cross-encoder. Mejora calidad pero añade latencia y requiere modelo extra. Opt-in.',
    default: false,
  },
  // KJC-PRP-0002 PR5: when the board scans plans, it visits both
  // ~/.karajan/plans/<slug>/ (per-user cache) and .karajan-shared/plans/
  // (team copy). If a planId lives in both, the second pass overwrites
  // the first. Before this knob the order was hard-coded shared-wins
  // (per-user → shared) — fine in a team but unsafe for a solo dev who
  // forgets a stale `.karajan-shared/` exists in the repo.
  {
    key: 'huBoardSharedConflictPolicy',
    path: 'huBoard.sharedConflictPolicy',
    category: 'huBoard',
    type: 'select',
    label: 'Política ante plan compartido y local',
    help: '"shared-wins" (recomendado en equipo): la copia en .karajan-shared/ pisa la local. "local-wins" (solo dev individual): tu copia en ~/.karajan/plans/ pisa la compartida — útil si todavía estás iterando antes de publicarla.',
    options: ['shared-wins', 'local-wins'],
    default: 'shared-wins',
  },
];

const ROLES_FOR_MODEL_MODE = [
  'planner', 'architect', 'coder', 'reviewer', 'triage',
  'researcher', 'tester', 'security', 'refactorer', 'impeccable'
];

function getDeep(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

// KJC-BUG-0076: never walk into Object.prototype via crafted YAML keys
// (`__proto__.x`, `constructor.prototype.y`, `prototype.z`). Silent skip
// over a poisoned segment — the rest of the path is untouched.
const UNSAFE_KEY_RE = /^(?:__proto__|constructor|prototype)$/;

function setDeep(obj, path, value) {
  if (typeof path !== 'string') return;
  const parts = path.split('.');
  const last = parts.pop();
  if (UNSAFE_KEY_RE.test(last)) return;
  let cur = obj;
  for (const p of parts) {
    if (UNSAFE_KEY_RE.test(p)) return;
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[last] = value;
}

function deleteDeep(obj, path) {
  if (typeof path !== 'string') return;
  const parts = path.split('.');
  const last = parts.pop();
  if (UNSAFE_KEY_RE.test(last)) return;
  let cur = obj;
  for (const p of parts) {
    if (UNSAFE_KEY_RE.test(p)) return;
    if (cur == null || typeof cur !== 'object') return;
    cur = cur[p];
  }
  if (cur && typeof cur === 'object') delete cur[last];
}

/**
 * Derive the virtual `modelMode` from the actual yml shape. Looks at
 * roles.<role>.model: if every editable role pins the same model,
 * that's the mode. Otherwise "auto" (the default — Karajan's
 * smart-select picks per role).
 */
function deriveModelMode(parsed) {
  const roles = parsed?.roles;
  if (!roles || typeof roles !== 'object') return 'auto';
  const seen = new Set();
  for (const r of ROLES_FOR_MODEL_MODE) {
    const m = roles[r]?.model;
    if (m) seen.add(String(m).toLowerCase());
  }
  if (seen.size === 1) {
    const only = [...seen][0];
    if (only === 'sonnet' || only === 'opus') return only;
  }
  return 'auto';
}

/**
 * Apply the virtual `modelMode` back to the yml: 'auto' deletes the
 * roles.<r>.model overrides; 'sonnet' / 'opus' set them on every
 * editable role. Other yml keys are left alone.
 */
function applyModelMode(parsed, mode) {
  if (!parsed.roles) parsed.roles = {};
  if (mode === 'auto') {
    for (const r of ROLES_FOR_MODEL_MODE) {
      if (parsed.roles[r]?.model) delete parsed.roles[r].model;
      if (parsed.roles[r] && Object.keys(parsed.roles[r]).length === 0) delete parsed.roles[r];
    }
    if (Object.keys(parsed.roles).length === 0) delete parsed.roles;
    return;
  }
  for (const r of ROLES_FOR_MODEL_MODE) {
    if (!parsed.roles[r] || typeof parsed.roles[r] !== 'object') parsed.roles[r] = {};
    parsed.roles[r].model = mode;
  }
}

/**
 * Read the current config + flatten it into the shape the UI wants:
 *   {
 *     path: "/abs/path",
 *     fields: [{ key, label, help, type, options?, value, default }],
 *     raw: <full parsed yml>          // power-user inspection
 *   }
 *
 * Returns sane defaults when the file doesn't exist yet.
 */
export function readConfig({ scope = 'global' } = {}) {
  // PR4 — accept scope. Default 'global' preserves the previous behavior;
  // 'project' reads <projectDir>/.karajan/kj.config.yml.
  if (!SCOPES.includes(scope)) {
    throw new Error(`Scope inválido: ${scope}. Permitidos: ${SCOPES.join(', ')}`);
  }
  const p = configPath(scope);
  let parsed = {};
  let exists = false;
  if (existsSync(p)) {
    try {
      parsed = yaml.load(readFileSync(p, 'utf8'), { json: true }) || {};
      exists = true;
    } catch (err) {
      throw new Error(`No se pudo parsear ${p}: ${err.message}`, { cause: err });
    }
  }
  const fields = EDITABLE_FIELDS.map((f) => {
    let value;
    if (f.key === 'modelMode') value = deriveModelMode(parsed);
    else value = getDeep(parsed, f.path);
    if (value === undefined) value = f.default;
    return { ...f, value };
  });
  // v2.30.0 — also expose CATEGORIES so the modal can render grouped
  // sections without re-importing the constant client-side. Ordered
  // by `order` for deterministic UI.
  const categories = [...CATEGORIES].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return { path: p, scope, exists, fields, categories, raw: parsed };
}

/**
 * Apply a patch (subset of EDITABLE_FIELDS keys → new values) to the
 * yml. Validates each field; refuses unknown keys. Writes via tmp +
 * rename; keeps a .bak.
 *
 * @returns {{ path: string, written: boolean, applied: object[], errors: string[] }}
 */
export function writeConfigPatch(patch, { scope = 'global' } = {}) {
  // PR4 — same shape as readConfig: scope decides target file.
  if (!SCOPES.includes(scope)) {
    return { path: '', scope, written: false, applied: [], errors: [`Scope inválido: ${scope}. Permitidos: ${SCOPES.join(', ')}`] };
  }
  if (!patch || typeof patch !== 'object') {
    return { path: configPath(scope), scope, written: false, applied: [], errors: ['patch debe ser un objeto'] };
  }
  // Read current state (or empty if file doesn't exist yet).
  const p = configPath(scope);
  let parsed = {};
  if (existsSync(p)) {
    try { parsed = yaml.load(readFileSync(p, 'utf8'), { json: true }) || {}; }
    catch (err) { return { path: p, scope, written: false, applied: [], errors: [`No se pudo parsear el yml actual: ${err.message}`] }; }
  }
  const errors = [];
  const applied = [];
  for (const [key, val] of Object.entries(patch)) {
    const field = EDITABLE_FIELDS.find((f) => f.key === key);
    if (!field) { errors.push(`Campo desconocido: ${key}`); continue; }

    if (field.type === 'select' && !field.options.includes(val)) {
      errors.push(`${key}: valor inválido "${val}". Permitidos: ${field.options.join(', ')}`);
      continue;
    }
    if (field.type === 'number') {
      const n = Number(val);
      if (!Number.isFinite(n)) { errors.push(`${key}: debe ser un número`); continue; }
      if (field.min != null && n < field.min) { errors.push(`${key}: mínimo ${field.min}`); continue; }
      if (field.max != null && n > field.max) { errors.push(`${key}: máximo ${field.max}`); continue; }
    }
    if (field.type === 'boolean' && typeof val !== 'boolean') {
      errors.push(`${key}: debe ser true o false`);
      continue;
    }

    if (field.key === 'modelMode') applyModelMode(parsed, val);
    else setDeep(parsed, field.path, field.type === 'number' ? Number(val) : val);
    applied.push({ key, value: val });
  }
  if (errors.length > 0) return { path: p, scope, written: false, applied, errors };

  // Write atomically: serialize → write to .tmp → rename. Backup the
  // existing file first so the user can recover.
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(p)) { try { copyFileSync(p, backupPath(scope)); } catch { /* best-effort */ } }
  const dump = yaml.dump(parsed, { lineWidth: 120 });
  // mkstemp would be nicer but we want to stay in the same dir for
  // a guaranteed-atomic rename across the same filesystem.
  const tmpFile = join(dir, `.kj.config.yml.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmpFile, dump, 'utf8');
  renameSync(tmpFile, p);
  return { path: p, scope, written: true, applied, errors: [] };
}

// Exposed for prototype-pollution regression tests (KJC-BUG-0076).
export const __pollutionInternals = { setDeep, deleteDeep };
