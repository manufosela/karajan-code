/**
 * karajan-code policy ADAPTER (GOV-A, KJC-TSK-0745, ADR 0003). El motor
 * vive en @karajan-family/governance (packages/governance): aquí queda SOLO lo
 * que es de este dominio — dónde vive el fichero de policy, los defaults
 * inexcepcionables del supervisor del Sentinel, y el mapeo de tools del
 * harness (Write/Edit/Bash…) a capabilities del kernel. La superficie
 * pública de este módulo no cambia: loadPolicy/evalToolCall/checkStagedDiff
 * siguen siendo lo que los gates de PL-B consumen.
 */
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { isReadOnlyCommand, stripTextOptionValues } from "../harden/sentinel/sentinel-shell.mjs";
import { escapeRegExp } from "../utils/escape-regexp.js";
import {
  ALLOW_VERDICT,
  checkArtifacts,
  denyVerdict,
  evalShell,
  evalWrite,
  parsePolicy,
  DEFAULT_POLICY as KERNEL_DEFAULT_POLICY,
} from "@karajan-family/governance";

// Defaults inexcepcionables de karajan-code: los ficheros del supervisor
// (antes hardcodeados en el PRETOOL del Sentinel — PL-B). Misma semántica
// textual: nombrarlos deniega, con o sin root, y la policy no los debilita.
export const SUPERVISOR_DEFAULTS = [
  {
    id: "defaults.supervisor.write",
    // ADR 0009: la provenance del supervisor es superficie de supervisor —
    // un agente no la escribe; solo kj harden --commit (humano) la produce.
    pattern: /\.claude\/settings\.json\b|\.karajan\/(hooks|harness)\/|\.karajan\/supervisor-provenance\.json\b/,
    message: "nombra ficheros del supervisor — solo el humano los modifica, fuera de la sesión",
  },
  {
    // KJC-TSK-1033 (owner's decision, 13-oct): a policy change is authorized where
    // it is USED (commit, CI, release), whatever wrote it: only the human's seal lifts it.
    id: "defaults.governance.write",
    // KJC-BUG-0400: the CI workflows too; a PR could rewrite the check that judges it.
    // KJC-BUG-0429: in shell text a relative path follows a blank or a quote, not a slash.
    pattern: /(^|[^\w.-])\.karajan\/(policy|rules)\.yml\b|(^|[^\w.-])\.github\/workflows\/[^/\s]+\.ya?ml\b/,
    // KJC-BUG-0508: the agent relays this to its person; without a phone they need the steps.
    message: "es configuración de gobierno: solo entra sellada por la persona (kj harden --commit desde su terminal, firmado desde su móvil). Sin móvil enrolado: abre https://karajancode.com/sign en el móvil y kj identity enroll-phone <clave pública>, o kj security normal mientras no hay móvil",
  },
];

// Tools del harness: mapeo acción → capability del kernel. Registro cerrado
// (fallo de solomon: lo desconocido no se permite a un rol DECLARADO).
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const READONLY_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch"]);

export const DEFAULT_POLICY = KERNEL_DEFAULT_POLICY;

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
 * declares something the engine cannot enforce — callers must surface it.
 */
export function loadPolicy({ projectDir = process.cwd(), deps = {} } = {}) {
  const { readFile = defaultReadFile } = deps;
  let raw;
  try {
    raw = readFile(projectDir);
  } catch (err) {
    return {
      policy: { ...KERNEL_DEFAULT_POLICY, defaults: SUPERVISOR_DEFAULTS },
      errors: [`policy.yml: ilegible (${err.code || err.message}) — presente pero no leible NO es "sin policy"`],
    };
  }
  return withSealedFiles(parsePolicy(raw, { defaults: SUPERVISOR_DEFAULTS }), projectDir);
}

// HU-3899 (owner's decision, 11-nov): sealed_files lists extra repo-relative files that
// enter only with the human's seal. The supervisor's own files keep their stronger proof.
const GLOB_CHARS = /[*?[\]{}!]/;
const isSealableFile = (f) =>
  typeof f === "string" && !f.startsWith("/") && !f.includes("\\") && !GLOB_CHARS.test(f)
  && f.split("/").every((s) => s !== "" && s !== "." && s !== "..")
  && !SUPERVISOR_DEFAULTS[0].pattern.test(f);

function sealedFilesErrors(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return ["policy.yml: sealed_files must be a list of repo-relative paths"];
  return list.filter((f) => !isSealableFile(f)).map((f) =>
    `policy.yml: sealed_files entry ${JSON.stringify(f)} must be a repo-relative POSIX path, without "..", leading "/", glob characters or supervisor files`);
}

const validSealedFiles = (list) => (Array.isArray(list) ? list.filter(isSealableFile) : []);

// The project root as given and, for a symlinked checkout, as resolved: an agent's
// Edit/Write passes an ABSOLUTE file_path, judged on its raw text.
function rootPrefixes(projectDir) {
  let real = projectDir;
  try { real = realpathSync(projectDir); } catch { /* a root that does not exist has no other spelling */ }
  return [...new Set([projectDir, real])].map((r) => String.raw`${escapeRegExp(r.replace(/\/+$/, ""))}\/`);
}

// Same anchoring as the built-in governance default, but a slash before the name is
// another directory (docs/AGENTS.md) and the name must end the path (AGENTS.md.bak).
function sealedFilesDefault(files, projectDir) {
  const names = files.map(escapeRegExp).join("|");
  const prefixes = [String.raw`\.\/`, ...rootPrefixes(projectDir)].join("|");
  const pattern = new RegExp(String.raw`(^|[^\w./-])(${prefixes})?(${names})(?=$|[^\w./-])`);
  return { ...SUPERVISOR_DEFAULTS[1], pattern };
}

function withSealedFiles({ policy, errors }, projectDir) {
  const files = validSealedFiles(policy.sealed_files);
  const allErrors = [...errors, ...sealedFilesErrors(policy.sealed_files)];
  if (files.length === 0) return { policy, errors: allErrors };
  const defaults = [...policy.defaults, sealedFilesDefault(files, projectDir)];
  return { policy: { ...policy, defaults }, errors: allErrors };
}

/** The validated sealed_files of the project's policy ([] when absent or unreadable). */
export function sealedFilesOf(projectDir, deps = {}) {
  return validSealedFiles(loadPolicy({ projectDir, deps }).policy.sealed_files);
}

/** One tool call against the policy. `root` permite evaluar file_path
 *  absolutos. Un rol DECLARADO solo usa tools del registro: lo desconocido
 *  es no-verificable ⇒ deny (roles sin declarar quedan como hoy). */
export function evalToolCall(policy, { role = "coder", tool, input = {}, root = null }) {
  if (WRITE_TOOLS.has(tool)) return evalWrite(policy, role, input.file_path || input.notebook_path, root);
  // KJC-BUG-0343: the inert prose of a text option (--title, --error, -m...) is
  // not a target: a report naming a supervisor path is not a write to it. A path
  // anywhere else, or a value that can expand, is still judged.
  if (tool === "Bash") {
    const command = stripTextOptionValues(String(input.command ?? ""));
    // KJC-BUG-0429 (ADR 0036): a command that only reads may name the guarded files;
    // the role's own shell rules still judge it.
    return evalShell(isReadOnlyCommand(command) ? { ...policy, defaults: [] } : policy, role, command);
  }
  if (READONLY_TOOLS.has(tool) || !policy.roles?.[role]) return ALLOW_VERDICT;
  return denyVerdict(`roles.${role}.tools`, `tool "${tool}" fuera del registro de la policy — no verificable para el rol declarado ${role}`);
}

/** El gate del RESULTADO en este dominio: los artefactos son los ficheros
 *  del diff staged y la métrica sale de numstat. */
export function checkStagedDiff(policy, facts) {
  return checkArtifacts(policy, facts);
}
