/**
 * policy engine — PL-A (KJC-TSK-0733, épica KJC-PCS-0074, ADR 0001).
 * Policy as DATA (`.karajan/policy.yml`, vocabulario CERRADO), engine as
 * code: módulo puro, determinista, sin red ni LLM. Una regla que el motor
 * no puede aplicar falla FUERTE al cargar — jamás se ignora en silencio.
 * Deny gana a allow; una allow-list convierte el exterior en denegación.
 * Consumidores: kj policy (PL-A) → gates PL-B → CI PL-C → middleware PL-D.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join, posix, relative } from "node:path";
import yaml from "js-yaml";
// GOV-A (KJC-TSK-0745): the glob primitive lives in the governance kernel.
import { commandPatternToRegExp, matchesAny } from "../../packages/governance/src/glob.js";

// Vocabulario CERRADO e incremental: cada capacidad entra al set EN el PR
// que trae su evaluación — declararla antes sería una regla que miente.
const ROLE_CAPS = new Set(["write", "shell"]);
const INVARIANT_KINDS = new Set(["diff-threshold"]);
const INVARIANT_METRICS = new Set(["net_lines_added"]);
// PL-B (KJC-TSK-0734): enforcement por regla y clase. Cerrados como todo lo
// demás — un valor desconocido es error de carga, nunca un default silencioso.
const ENFORCEMENTS = new Set(["warn", "deny"]);
const CLASSES = new Set(["security"]);
// Defaults embarcados del supervisor (antes hardcodeados en el PRETOOL del
// Sentinel): se evalúan SIEMPRE, antes que los caps del rol, y ninguna
// policy de proyecto los debilita. Misma semántica textual que el PRETOOL:
// nombrar estos ficheros deniega, con o sin root.
const SUPERVISOR_RE = /\.claude\/settings\.json\b|\.karajan\/(hooks|harness)\//;
const supervisorDeny = (rule_id, what) => ({
  decision: "deny", rule_id, enforcement: "deny", class: "security",
  reason: `${what} nombra ficheros del supervisor — solo el humano los modifica, fuera de la sesión`,
});
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
// Registro de tools conocidas (fallo de solomon: lo desconocido no se
// permite a un rol DECLARADO — crece por PR consciente).
const READONLY_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch"]);
export const DEFAULT_POLICY = Object.freeze({ version: 1, roles: {}, invariants: [] });

function defaultReadFile(projectDir) {
  try {
    return readFileSync(join(projectDir, ".karajan", "policy.yml"), "utf8");
  } catch (err) {
    // Solo ENOENT es "sin policy"; EACCES/EIO seria un fallback silencioso.
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * @returns {{policy: object, errors: string[]}} errors non-empty ⇒ the file
 * declares something this engine cannot enforce — callers must surface it.
 */
export function loadPolicy({ projectDir = process.cwd(), deps = {} } = {}) {
  const { readFile = defaultReadFile } = deps;
  let raw;
  try {
    raw = readFile(projectDir);
  } catch (err) {
    return { policy: DEFAULT_POLICY, errors: [`policy.yml: ilegible (${err.code || err.message}) — presente pero no leible NO es "sin policy"`] };
  }
  if (raw == null) return { policy: DEFAULT_POLICY, errors: [] };

  const errors = [];
  let doc;
  try {
    doc = yaml.load(raw) || {};
  } catch (err) {
    return { policy: DEFAULT_POLICY, errors: [`policy.yml: YAML invalido — ${err.message}`] };
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return { policy: DEFAULT_POLICY, errors: ["policy.yml: la raiz debe ser un objeto"] };
  }
  if (doc.version !== 1) {
    errors.push(`policy.yml: version "${doc.version}" no soportada — este motor habla version 1`);
  }
  const roles = doc.roles ?? {};
  if (typeof roles !== "object" || roles === null || Array.isArray(roles)) {
    errors.push("policy.yml: roles debe ser un objeto");
  } else {
    validateRoles(roles, errors);
  }
  const invs = doc.invariants ?? [];
  if (Array.isArray(invs)) {
    for (const inv of invs) {
      if (!INVARIANT_KINDS.has(inv?.kind)) {
        errors.push(`policy.yml: invariant "${inv?.id}" con kind "${inv?.kind}" no existe en el vocabulario v1`);
      } else if (!INVARIANT_METRICS.has(inv?.metric) || !Number.isFinite(inv?.max) || typeof inv?.id !== "string") {
        errors.push(`policy.yml: invariant "${inv?.id}" requiere id string, metric (${[...INVARIANT_METRICS].join(", ")}) y max numérico`);
      } else if (inv?.enforcement !== undefined && !ENFORCEMENTS.has(inv.enforcement)) {
        errors.push(`policy.yml: invariant "${inv.id}" enforcement "${inv.enforcement}" no existe en el vocabulario (v1: ${[...ENFORCEMENTS].join(", ")})`);
      }
    }
  } else {
    errors.push("policy.yml: invariants debe ser una lista");
  }
  return { policy: { roles: {}, invariants: [], ...doc }, errors };
}

function validateRoles(roles, errors) {
  for (const [role, caps] of Object.entries(roles)) {
    for (const [cap, spec] of Object.entries(caps || {})) {
      if (!ROLE_CAPS.has(cap)) {
        errors.push(`policy.yml: roles.${role}.${cap} no existe en el vocabulario (v1: ${[...ROLE_CAPS].join(", ")})`);
        continue;
      }
      if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
        errors.push(`policy.yml: roles.${role}.${cap} debe ser un objeto {allow, deny}`);
        continue;
      }
      for (const key of Object.keys(spec)) {
        if (!["allow", "deny", "enforcement", "class"].includes(key)) {
          errors.push(`policy.yml: roles.${role}.${cap}.${key} no existe en el vocabulario (v1: allow, deny, enforcement, class)`);
        }
      }
      for (const list of ["allow", "deny"]) {
        const v = spec?.[list];
        if (v !== undefined && (!Array.isArray(v) || v.some((g) => typeof g !== "string"))) {
          errors.push(`policy.yml: roles.${role}.${cap}.${list} debe ser una lista de strings (glob)`);
        }
      }
      if (spec.enforcement !== undefined && !ENFORCEMENTS.has(spec.enforcement)) {
        errors.push(`policy.yml: roles.${role}.${cap}.enforcement "${spec.enforcement}" no existe en el vocabulario (v1: ${[...ENFORCEMENTS].join(", ")})`);
      }
      if (spec.class !== undefined && !CLASSES.has(spec.class)) {
        errors.push(`policy.yml: roles.${role}.${cap}.class "${spec.class}" no existe en el vocabulario (v1: ${[...CLASSES].join(", ")})`);
      }
    }
  }
}

const deny = (rule_id, reason) => ({ decision: "deny", rule_id, reason });
const ALLOW = Object.freeze({ decision: "allow" });

// Normaliza el destino a ruta RELATIVA canónica: absolutas se relativizan
// contra root (sin root ⇒ null), y `..`/escapes ⇒ null (reviewer catch:
// src/../.env no puede esquivar los globs, ni una absoluta salirse del root).
function normalizeTarget(filePath, root) {
  let p = String(filePath).replaceAll("\\", "/");
  if (isAbsolute(p)) {
    if (!root) return null;
    p = relative(root, p).replaceAll("\\", "/");
  }
  p = posix.normalize(p).replace(/^\.\//, "");
  return p.startsWith("..") || isAbsolute(p) ? null : p;
}

// enforcement/class del cap viajan en cada deny (default warn = PL-A intacto).
const capMeta = (spec) => ({ enforcement: spec?.enforcement || "warn", ...(spec?.class ? { class: spec.class } : {}) });

function evalWrite(policy, role, filePath, root) {
  // Defaults del supervisor primero: sobre el TEXTO del destino (con o sin
  // root), igual que el PRETOOL que sustituyen — la policy no los debilita.
  if (filePath && SUPERVISOR_RE.test(String(filePath).replaceAll("\\", "/"))) {
    return supervisorDeny("defaults.supervisor.write", `el destino "${filePath}"`);
  }
  const write = policy.roles?.[role]?.write;
  if (!write) return ALLOW;
  // Rol restringido + destino ausente/no-canonizable = no verificable ⇒ deny
  // (reviewer catches: tool call malformado, traversal, absoluta sin root).
  const p = filePath ? normalizeTarget(filePath, root) : null;
  if (p == null) return { ...deny(`roles.${role}.write`, `destino "${filePath ?? ""}" no verificable contra la policy del rol ${role}`), ...capMeta(write) };
  if (matchesAny(p, write.deny)) {
    return { ...deny(`roles.${role}.write.deny`, `${p} esta denegado para el rol ${role}`), ...capMeta(write) };
  }
  if (Array.isArray(write.allow) && !matchesAny(p, write.allow)) {
    return { ...deny(`roles.${role}.write.allow`, `${p} esta fuera de la allow-list de escritura del rol ${role}`), ...capMeta(write) };
  }
  return ALLOW;
}

// Launchers y asignaciones de entorno se PELAN antes de casar patrones
// (reviewer catch: "sudo git push" o "FOO=1 git add -A" no esquivan la
// regla del subcomando real); capas excesivas ⇒ opaco ⇒ deny.
const LAUNCHER_RE = /^(sudo(\s+-\S+)*|command|nohup|time|nice(\s+-n\s*\d+)?|stdbuf\s+\S+|env)\s+|^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;
function stripLaunchers(seg) {
  let s = seg;
  for (let i = 0; i < 5; i++) {
    const m = s.match(LAUNCHER_RE);
    if (!m) return s;
    // Asignaciones que alteran QUÉ ejecutable resuelve (PATH, LD_*, GIT_*,
    // NODE_OPTIONS) o llevan expansión son opacas — no se pelan, denegan.
    if (/^(PATH|LD_\w*|NODE_OPTIONS|GIT_\w*)=/.test(m[0]) || m[0].includes("$")) return null;
    s = s.slice(m[0].length);
  }
  return null; // sigue envuelto tras 5 capas: no verificable
}

// Tokenizador consciente de comillas: separa segmentos SOLO por operadores
// no entrecomillados (reviewer catch: un ';' dentro de un mensaje no es
// separador) y canonicaliza tokens sin comillas a la vez. Cualquier
// construcción que ejecute o redirija texto opaco al análisis — escapes,
// expansión ($ salvo entre comillas simples), sustitución/backticks,
// redirecciones, backgrounding, comillas sin cerrar — devuelve null.
function parseCommand(cmd) {
  const segs = [];
  let toks = [];
  let cur = "";
  let q = null;
  const pushTok = () => {
    if (cur) {
      toks.push(cur);
      cur = "";
    }
  };
  const pushSeg = () => {
    pushTok();
    if (toks.length > 0) {
      segs.push(toks.join(" "));
      toks = [];
    }
  };
  const s = String(cmd);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" || ch === "`") return null;
    if (ch === "$" && q !== "'") return null;
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      continue;
    }
    if (ch === ">" || ch === "<") return null;
    if (ch === "&" && s[i + 1] === "&") {
      pushSeg();
      i++;
      continue;
    }
    if (ch === "|" && s[i + 1] === "|") {
      pushSeg();
      i++;
      continue;
    }
    if (ch === "&") return null;
    if (ch === ";" || ch === "|" || ch === "\n") {
      pushSeg();
      continue;
    }
    if (/\s/.test(ch)) {
      pushTok();
      continue;
    }
    cur += ch;
  }
  if (q) return null;
  pushSeg();
  return segs;
}

// Envolturas que re-ejecutan texto (lección del guard del Sentinel).
const WRAPPER_RE = /^(sh|bash|zsh|dash|ksh)\s+(-\S+\s+)*-\S*c(\s|$)|^eval\b|^xargs\b|^source\b|^\.\s/;

// Deny si CUALQUIER segmento casa; con allow-list, CADA segmento debe casar.
function evalShell(policy, role, command) {
  // Defaults del supervisor: un Bash que NOMBRA sus ficheros deniega, con o
  // sin caps del rol (misma semántica textual que el PRETOOL que sustituyen).
  if (command && SUPERVISOR_RE.test(String(command).replaceAll("\\", "/"))) {
    return supervisorDeny("defaults.supervisor.shell", "el comando");
  }
  const shell = policy.roles?.[role]?.shell;
  if (!shell) return ALLOW;
  const meta = capMeta(shell);
  if (!command) return { ...deny(`roles.${role}.shell`, `comando ausente — no verificable para el rol ${role}`), ...meta };
  const segs = parseCommand(command);
  if (segs == null) {
    return { ...deny(`roles.${role}.shell`, "construcciones opacas (escapes, expansión, sustitución, redirecciones, backgrounding o comillas sin cerrar) — no verificable"), ...meta };
  }
  for (const raw of segs) {
    const seg = stripLaunchers(raw);
    if (seg == null) return { ...deny(`roles.${role}.shell`, `el segmento "${raw}" no es canonicalizable — no verificable`), ...meta };
    if (WRAPPER_RE.test(seg)) return { ...deny(`roles.${role}.shell`, `el segmento "${seg}" re-ejecuta texto (envoltura/eval) — no verificable`), ...meta };
    const hit = Array.isArray(shell.deny) && shell.deny.find((p) => commandPatternToRegExp(p).test(seg));
    if (hit) return { ...deny(`roles.${role}.shell.deny`, `el segmento "${seg}" casa con el patrón denegado "${hit}"`), ...meta };
    if (Array.isArray(shell.allow) && !shell.allow.some((p) => commandPatternToRegExp(p).test(seg))) {
      return { ...deny(`roles.${role}.shell.allow`, `el segmento "${seg}" está fuera de la allow-list de shell del rol ${role}`), ...meta };
    }
  }
  return ALLOW;
}

/** One tool call against the policy. `root` permite evaluar file_path
 *  absolutos. Un rol DECLARADO solo usa tools del registro: lo desconocido
 *  es no-verificable ⇒ deny (roles sin declarar quedan como hoy). */
export function evalToolCall(policy, { role = "coder", tool, input = {}, root = null }) {
  if (WRITE_TOOLS.has(tool)) return evalWrite(policy, role, input.file_path || input.notebook_path, root);
  if (tool === "Bash") return evalShell(policy, role, input.command);
  if (READONLY_TOOLS.has(tool) || !policy.roles?.[role]) return ALLOW;
  return deny(`roles.${role}.tools`, `tool "${tool}" fuera del registro de la policy — no verificable para el rol declarado ${role}`);
}

/** El gate del RESULTADO: ficheros del diff + métricas contra rol e invariantes. */
export function checkStagedDiff(policy, { role = "coder", files = [], netLinesAdded = null } = {}) {
  const violations = [];
  for (const f of files) {
    const r = evalWrite(policy, role, f);
    if (r.decision === "deny") violations.push({ rule_id: r.rule_id, reason: r.reason, file: f, enforcement: r.enforcement || "warn", ...(r.class ? { class: r.class } : {}) });
  }
  for (const inv of policy.invariants || []) {
    if (inv.kind !== "diff-threshold" || inv.metric !== "net_lines_added") continue;
    const meta = { enforcement: inv.enforcement || "warn" };
    if (!Number.isFinite(netLinesAdded)) {
      // Métrica ausente con invariante declarado = no verificable, jamás un
      // pase silencioso (reviewer catch).
      violations.push({ rule_id: inv.id, reason: "net_lines_added no disponible — el invariante no es verificable sin la métrica", ...meta });
    } else if (netLinesAdded > inv.max) {
      violations.push({ rule_id: inv.id, reason: `net_lines_added=${netLinesAdded} supera el máximo ${inv.max}`, ...meta });
    }
  }
  return violations;
}
