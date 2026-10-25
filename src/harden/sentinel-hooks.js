/**
 * sentinel-hooks — SEN-A (KJC-TSK-0713, epic KJC-PCS-0071 Karajan Sentinel).
 * v3 had authority without intelligence; v4 intelligence without authority.
 * The Sentinel separates them: a deterministic PROGRAM (zero LLM) supervises
 * the agent through the harness's synchronous hooks — PostToolUse records
 * method facts per session, Stop BLOCKS ending the turn while violations are
 * open. Claude Code only: it is the one harness with synchronous blocking
 * hooks, which is why the guaranteed level requires Claude as host (ADR).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { HARNESS_BODIES, mergeClaudeHooks, writeHarnessScript } from "./harness-hooks.js";

/** The harness lives at the PROJECT root — resolve it even from a subdir. */
export function resolveSentinelRoot(dir = process.cwd()) {
  try {
    return (
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || dir
    );
  } catch {
    return dir;
  }
}

// KJC-TSK-0915 (ADR 0014), KJC-BUG-0402 (ADR 0030): every guard is a real module,
// copied byte for byte under the SAME name (so they can import each other in both
// places). Being here, the installed record, the tamper check and the human seal
// cover them; being files, they can also run from the installed package.
// Each read stays a literal: the single-file build inlines exactly that form.
const SCRIPT_BODIES = {
  "sentinel-lib.mjs": readFileSync(new URL("./sentinel/sentinel-lib.mjs", import.meta.url), "utf8"),
  "posttooluse.mjs": readFileSync(new URL("./sentinel/posttooluse.mjs", import.meta.url), "utf8"),
  "stop.mjs": readFileSync(new URL("./sentinel/stop.mjs", import.meta.url), "utf8"),
  "pretooluse-sentinel.mjs": readFileSync(new URL("./sentinel/pretooluse-sentinel.mjs", import.meta.url), "utf8"),
  "sentinel-shell.mjs": readFileSync(new URL("./sentinel/sentinel-shell.mjs", import.meta.url), "utf8"),
  "sentinel-discard.mjs": readFileSync(new URL("./sentinel/sentinel-discard.mjs", import.meta.url), "utf8"),
  "sentinel-bash-write.mjs": readFileSync(new URL("./sentinel/sentinel-bash-write.mjs", import.meta.url), "utf8"),
  "sentinel-reminders.mjs": readFileSync(new URL("./sentinel/sentinel-reminders.mjs", import.meta.url), "utf8"),
  "sessionstart.mjs": readFileSync(new URL("./sentinel/sessionstart.mjs", import.meta.url), "utf8"),
  // KJC-TSK-0946 (ADR 0016): the rules gate and its hook, for every tool call.
  "sentinel-rules.mjs": readFileSync(new URL("./sentinel/sentinel-rules.mjs", import.meta.url), "utf8"),
  "pretooluse-rules.mjs": readFileSync(new URL("./sentinel/pretooluse-rules.mjs", import.meta.url), "utf8"),
};

/**
 * Tamper detection (KJC-TSK-0715): compare the on-disk harness scripts with
 * what THIS kj install would write. The root of trust is the installed kj
 * package — outside the project tree, beyond the session's tool reach —
 * because nothing under .karajan can vouch for itself.
 */
const PROVENANCE_PATH = ".karajan/supervisor-provenance.json";

/**
 * KJC-BUG-0211: el cuerpo que kj escribiria para ese guardia, venga de las
 * plantillas del Sentinel o de las del harness. Quien verifica un sello
 * recomputa con esto; sin el, un sello que cubre los guardias (KJC-BUG-0197)
 * no se puede ni commitear, porque nadie sabe comprobarlos.
 */
export const canonicalHarnessBody = (name) => SCRIPT_BODIES[name] ?? HARNESS_BODIES[name] ?? null;

/**
 * KJC-BUG-0197: what did a human actually seal, per guard?
 *
 * Read from **git**, never from the working tree. The provenance is tracked and
 * written only by `kj harden --commit` (a human act with four layers, ADR 0009),
 * so the committed copy is the external reference; the copy on disk is as
 * forgeable as the guard it would vouch for, and the review caught exactly that.
 * No git, no commit, no seal: then nothing is forgiven and the check fails
 * closed, which is the safe direction.
 *
 * The map is keyed BY PATH: a hash sealed for one file never vouches for
 * another (also the review's catch).
 *
 * @returns {Map<string, string>} relative path → sealed sha256
 */
function sealedByPath(projectDir, gitShowFn) {
  try {
    const raw = gitShowFn
      ? gitShowFn(projectDir, PROVENANCE_PATH)
      : execFileSync("git", ["-C", projectDir, "show", `HEAD:${PROVENANCE_PATH}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const files = JSON.parse(raw)?.files;
    const out = new Map();
    for (const entry of Array.isArray(files) ? files : []) {
      if (typeof entry?.file === "string" && typeof entry?.sha256 === "string") out.set(entry.file, entry.sha256);
    }
    return out;
  } catch {
    return new Map();
  }
}

/**
 * KJC-BUG-0224: la procedencia PROPIA del harness, lo que `kj harden` escribio
 * (sha256 por guardia). Distinto del sello humano: no concede nada, solo dice
 * "esto lo puso kj", y lo unico que habilita es regenerar desde el kj
 * instalado. Forjarlo, por tanto, solo consigue que el guardia se restaure.
 */
const INSTALLED_RECORD = "installed.json";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function readInstalledRecord(dir) {
  try {
    const files = JSON.parse(readFileSync(join(dir, INSTALLED_RECORD), "utf8"))?.files;
    return files && typeof files === "object" ? files : {};
  } catch {
    return {};
  }
}

function writeInstalledRecord(dir) {
  const files = {};
  for (const name of Object.keys(SCRIPT_BODIES)) {
    try { files[name] = sha256(readFileSync(join(dir, name), "utf8")); } catch { /* sin fichero no hay nada que registrar */ }
  }
  writeFileSync(join(dir, INSTALLED_RECORD), `${JSON.stringify({ files }, null, 2)}\n`);
}

/**
 * @returns {{ok: boolean, mismatched: string[], drift?: string[], regenerated?: string[], reason?: string}}
 *   `mismatched` is TAMPERING: a guard holds content nobody sealed, and that is
 *   what the hooks block on. `drift` is a sealed guard whose templates have
 *   moved on, which `kj harden` applies and which is not a defect.
 */
export function verifySentinelScripts({ projectDir, readFileFn = readFileSync, gitShowFn = null } = {}) {
  const root = projectDir || resolveSentinelRoot();
  const dir = join(root, ".karajan", "harness");
  const installed = new Map();
  const mismatched = [];
  for (const [name, body] of Object.entries(SCRIPT_BODIES)) {
    try {
      const text = readFileFn(join(dir, name), "utf8");
      installed.set(name, text);
      if (text !== body) mismatched.push(name);
    } catch {
      mismatched.push(name); // missing: there is no content for a seal to cover
    }
  }
  if (mismatched.length === 0) return { ok: true, mismatched: [] };

  // A mismatch is only forgiven when what sits there is something a human
  // sealed. Editing a guard produces content no seal covers, so the forgiveness
  // cannot be borrowed by also editing a template: that was the hole in the
  // first attempt at this fix, and the review was right to reject it.
  const sealed = sealedByPath(root, gitShowFn);
  const ownRecord = readInstalledRecord(dir);
  const hasRecord = existsSync(join(dir, INSTALLED_RECORD));
  const drift = [];
  const tampered = [];
  const regenerated = [];
  for (const name of mismatched) {
    const text = installed.get(name);
    const hash = text === undefined ? null : sha256(text);
    if (hash && sealed.get(`.karajan/harness/${name}`) === hash) drift.push(name);
    else if (hash && ownRecord[name] === hash) regenerated.push(name);
    // KJC-TSK-0915: absent from an install kj RECORDED (installed.json exists), never
    // recorded and never sealed = a guard newer than this install, not a deleted
    // one. Writing it only adds. A dir with no record is not a kj install at all.
    else if (!hash && hasRecord && !Object.hasOwn(ownRecord, name) && !sealed.has(`.karajan/harness/${name}`)) regenerated.push(name);
    else tampered.push(name);
  }
  // KJC-BUG-0224 caso 1: lo que kj escribio y nadie sello ni toco se pone al
  // dia solo. Es lo que hacia el ritual de `kj harden`, hecho por la maquina.
  if (regenerated.length > 0) {
    for (const name of regenerated) writeHarnessScript(root, name, SCRIPT_BODIES[name]);
    writeInstalledRecord(dir);
  }
  const done = regenerated.length ? { regenerated } : {};
  if (tampered.length > 0) return { ok: false, mismatched: tampered, ...(drift.length ? { drift } : {}), ...done };
  if (drift.length === 0) {
    return { ok: true, mismatched: [], ...done, reason: `kj avanzó y estos guardias eran los que kj escribió: regenerados (${regenerated.join(", ")})` };
  }
  return {
    ...done,
    ok: true,
    mismatched: [],
    drift,
    // KJC-BUG-0222: `kj harden` NO pone al dia un guard sellado, lo deja en paz
    // a proposito (KJC-BUG-0193), asi que mandarlo era un bucle: ejecutas,
    // sale "unchanged" y el gate repite lo mismo. El que resuelve ESTE estado
    // es `kj harden --commit`, y es acto del humano.
    reason: "el harness instalado está sellado y las plantillas de este árbol van por delante — no es manipulación, y `kj harden` lo deja como está a propósito: quien lo avanza es el humano con `kj harden --commit`",
  };
}

/**
 * Write the sentinel scripts (shared lib + state writer + gates) and wire them.
 *
 * KJC-BUG-0193: a guard holding exactly what a human sealed is LEFT ALONE. This
 * is the command a session reaches for when it has edited the templates, and
 * rewriting the guards here un-sealed the ones actually running, so the very act
 * of unblocking destroyed the seal that made unblocking unnecessary. Advancing
 * them is a human act: `kj harden --commit` moves guards and seal together.
 * Anything nobody sealed is rewritten as before, because restoring a tampered
 * guard is still the right move.
 */
export function installSentinelHooks({ projectDir = process.cwd(), logger = console, human = false, gitShowFn = null } = {}) {
  // KJC-BUG-0223: instalado desde un subdirectorio, esto sembraba un segundo
  // `.karajan/harness` ahi, y el gate (que mira otro sitio) pasaba a verlo. El
  // ritual quedaba "arreglado" y el arbol se llenaba de arneses huerfanos que
  // no gobiernan nada. El harness es del proyecto: va a su raiz.
  const root = resolveSentinelRoot(projectDir);
  if (root !== projectDir) logger?.info?.(`kj harden: el harness es del proyecto, se instala en su raíz (${root})`);
  projectDir = root;
  const sealed = human ? new Map() : sealedByPath(projectDir, gitShowFn);
  const deferred = [];
  const keepsItsSeal = (name) => {
    const sealedHash = sealed.get(`.karajan/harness/${name}`);
    if (!sealedHash) return false;
    try {
      return sealedHash === createHash("sha256").update(readFileSync(join(projectDir, ".karajan", "harness", name), "utf8")).digest("hex");
    } catch {
      return false; // no hay contenido que un sello pueda cubrir
    }
  };
  const [lib, post, stop, pre] = Object.entries(SCRIPT_BODIES).map(([name, body]) => {
    if (keepsItsSeal(name)) {
      const abs = join(projectDir, ".karajan", "harness", name);
      // KJC-BUG-0325: only a sealed guard the current template would change is
      // waiting for the human; one identical to it has nothing to advance.
      if (readFileSync(abs, "utf8") !== body) deferred.push(name);
      return abs;
    }
    return writeHarnessScript(projectDir, name, body);
  });
  writeInstalledRecord(join(projectDir, ".karajan", "harness"));
  if (deferred.length > 0) {
    logger?.info?.(`kj harden: ${deferred.join(", ")} se queda como está — es lo que un humano selló, y avanzarlo es suyo: kj harden --commit`);
  }
  const { wired } = mergeClaudeHooks({
    projectDir,
    logger,
    entries: [
      { event: "PreToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit", script: "pretooluse-sentinel.mjs" },
      { event: "PreToolUse", matcher: "Bash", script: "pretooluse-sentinel.mjs" },
      // KJC-TSK-0946 (ADR 0016): no matcher. The rules of the MD files are checked
      // before EVERY tool call, MCP ones included.
      { event: "PreToolUse", script: "pretooluse-rules.mjs" },
      { event: "PostToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit", script: "posttooluse.mjs" },
      // KJC-TSK-0765 board-sync: the merge (Bash) and the tracker move (MCP
      // update_card) are observed AFTER the fact — found live: with only the
      // edit matchers wired, the board-sync recorder never ran in production.
      { event: "PostToolUse", matcher: "Bash", script: "posttooluse.mjs" },
      { event: "PostToolUse", matcher: "mcp__.*__update_card", script: "posttooluse.mjs" },
      // KJC-BUG-0236 (#1886): the rag-first ledger records MCP answers here;
      // unwired, the official tool never satisfied the gate.
      { event: "PostToolUse", matcher: "mcp__.*__kj_rag_query", script: "posttooluse.mjs" },
      { event: "Stop", script: "stop.mjs" },
      // KJC-TSK-0918 (ADR 0014): the critical rules back after a compaction or a resume.
      { event: "SessionStart", matcher: "compact", script: "sessionstart.mjs" },
      { event: "SessionStart", matcher: "resume", script: "sessionstart.mjs" },
      // KJC-TSK-0949: a new session hears of MD rules with no gate, and nothing else.
      { event: "SessionStart", matcher: "startup", script: "sessionstart.mjs" },
    ],
  });
  return { scripts: [lib, post, stop, pre], wired, deferred };
}
