// The Sentinel's rules gate (KJC-TSK-0939, MDR-C, ADR 0016). A real module with
// no dependencies: kj harden copies it byte for byte into .karajan/harness as
// sentinel-rules.mjs, and this code is unit-tested.
//
// The rules written in the MD files, compiled into .karajan/rules.yml, are asked
// to kj before EVERY tool call. kj decides (exit 0 allow, 2 deny); whatever
// cannot be evaluated is denied, because rules silently off would be every call
// allowed. With no rules.yml the gate does not exist and costs nothing.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RULES_FILE = join(".karajan", "rules.yml");
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const KJ_DOES_NOT_START = /SyntaxError|ReferenceError|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM/;

/**
 * KJC-BUG-0207: a kj that does not start (a linked tree with a syntax error) is
 * not a verdict. Returns the file its stack names, "" when it names none, or
 * null when kj did start.
 * @param {string} stderr
 */
export const brokenKjFile = (stderr) => {
  const text = String(stderr || "");
  if (!KJ_DOES_NOT_START.test(text)) return null;
  // The location line node prints: a path or file: URL (blanks allowed), then :line.
  const at = text.split("\n").map((line) => line.trim()).find((line) => /^(file:|\/|[A-Za-z]:\\).*\.(m?js|cjs|ts):\d+$/.test(line)) || "";
  const file = at.slice(0, at.lastIndexOf(":"));
  return file.startsWith("file:") ? fileURLToPath(file) : file;
};

const lastJson = (stdout) => {
  try { return JSON.parse(String(stdout || "").trim().split("\n").pop()); } catch { return null; }
};
const deny = (message) => ({ deny: true, message });

/**
 * KJC-TSK-0949 (MDR-E2): an MD changed and what was compiled no longer covers
 * it. One line for the session's start, or "" when every rule is decided, there
 * is no rules.yml, or kj cannot tell (a notice never fails a session).
 * @param {{root: string, run: Function, exists?: Function}} opts
 * @returns {string}
 */
export function rulesDriftNotice({ root, run, exists = existsSync }) {
  if (!exists(join(root, RULES_FILE))) return "";
  const res = run("kj", ["rules", "coverage", "--json"], { cwd: root, encoding: "utf8" });
  const counts = res.error || res.status !== 0 ? null : lastJson(res.stdout)?.counts;
  const none = Number(counts?.none) || 0;
  const stale = Number(counts?.stale) || 0;
  if (none + stale === 0) return "";
  return none + " sin gate y " + stale + " desfasada(s) entre las reglas de tus MD (" + RULES_FILE + "). Ejecuta kj rules compile, "
    + "escribe la propuesta y pide a tu usuario que la apruebe (kj rules approve); kj rules coverage las nombra.";
}

/**
 * @param {{root: string, tool: string, input?: object, run: Function, exists?: Function}} call
 *   `run` is spawnSync (injected so the gate is testable without a process).
 * @returns {{deny: boolean, message?: string}}
 */
export function rulesGate({ root, tool, input, run, exists = existsSync }) {
  if (!exists(join(root, RULES_FILE))) return { deny: false };
  // The input goes on stdin: a large Write does not fit in an argument.
  const res = run("kj", ["rules", "eval", "--tool", String(tool), "--input", "-"], { cwd: root, encoding: "utf8", input: JSON.stringify(input ?? {}) });
  if (res.error || res.status === null) {
    return deny(RULES_FILE + " declara reglas pero kj no es ejecutable, así que no se pueden evaluar: restaura kj en el PATH.");
  }
  if (res.status === 0) return { deny: false };
  const out = lastJson(res.stdout);
  if (res.status === 2) {
    const source = out?.source ? " (" + out.source + ")" : "";
    const what = String(out?.message ?? "la acción rompe una regla de los MD").replace(/[.\s]+$/, "");
    return deny("regla " + (out?.rule_id ?? "sin identificar") + source + ": " + what + ". Sin escape (ADR 0016): si la regla está mal compilada, la corrige tu usuario.");
  }
  const broken = brokenKjFile(res.stderr);
  if (broken !== null) {
    const target = input?.file_path || input?.notebook_path || "";
    if (EDIT_TOOLS.has(tool) && broken && target && resolve(String(target)) === resolve(broken)) return { deny: false };
    return deny("kj no arranca" + (broken ? " (" + broken + ")" : "") + ", así que las reglas no se pueden evaluar y nada más pasa: arregla ese fichero.");
  }
  const why = Array.isArray(out?.errors) ? out.errors.join("; ") : "exit " + res.status;
  return deny(RULES_FILE + " no se puede evaluar (" + why + "): lo corrige tu usuario, fuera de la sesión.");
}
