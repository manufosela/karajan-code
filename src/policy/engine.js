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
import { matchesAny } from "./glob.js";

// Vocabulario CERRADO e incremental: cada capacidad entra al set EN el PR
// que trae su evaluación — declararla antes sería una regla que miente.
const ROLE_CAPS = new Set(["write"]);
const INVARIANT_KINDS = new Set([]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
// Registro de tools conocidas (fallo de solomon: lo desconocido no se
// permite a un rol DECLARADO — crece por PR consciente). Bash es conocida:
// su capacidad shell se evalúa cuando el kind entre al vocabulario.
const READONLY_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch"]);
const KNOWN_PENDING_TOOLS = new Set(["Bash"]);
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
  if (!Array.isArray(invs)) errors.push("policy.yml: invariants debe ser una lista");
  else {
    for (const inv of invs) {
      if (!INVARIANT_KINDS.has(inv?.kind)) {
        errors.push(`policy.yml: invariant "${inv?.id}" con kind "${inv?.kind}" no existe en el vocabulario v1`);
      }
    }
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
        if (key !== "allow" && key !== "deny") {
          errors.push(`policy.yml: roles.${role}.${cap}.${key} no existe en el vocabulario (v1: allow, deny)`);
        }
      }
      for (const list of ["allow", "deny"]) {
        const v = spec?.[list];
        if (v !== undefined && (!Array.isArray(v) || v.some((g) => typeof g !== "string"))) {
          errors.push(`policy.yml: roles.${role}.${cap}.${list} debe ser una lista de strings (glob)`);
        }
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

function evalWrite(policy, role, filePath, root) {
  const write = policy.roles?.[role]?.write;
  if (!write) return ALLOW;
  // Rol restringido + destino ausente/no-canonizable = no verificable ⇒ deny
  // (reviewer catches: tool call malformado, traversal, absoluta sin root).
  const p = filePath ? normalizeTarget(filePath, root) : null;
  if (p == null) return deny(`roles.${role}.write`, `destino "${filePath ?? ""}" no verificable contra la policy del rol ${role}`);
  if (matchesAny(p, write.deny)) {
    return deny(`roles.${role}.write.deny`, `${p} esta denegado para el rol ${role}`);
  }
  if (Array.isArray(write.allow) && !matchesAny(p, write.allow)) {
    return deny(`roles.${role}.write.allow`, `${p} esta fuera de la allow-list de escritura del rol ${role}`);
  }
  return ALLOW;
}

/** One tool call against the policy. `root` permite evaluar file_path
 *  absolutos. Un rol DECLARADO solo usa tools del registro: lo desconocido
 *  es no-verificable ⇒ deny (roles sin declarar quedan como hoy). */
export function evalToolCall(policy, { role = "coder", tool, input = {}, root = null }) {
  if (WRITE_TOOLS.has(tool)) return evalWrite(policy, role, input.file_path || input.notebook_path, root);
  if (READONLY_TOOLS.has(tool) || KNOWN_PENDING_TOOLS.has(tool) || !policy.roles?.[role]) return ALLOW;
  return deny(`roles.${role}.tools`, `tool "${tool}" fuera del registro de la policy — no verificable para el rol declarado ${role}`);
}
