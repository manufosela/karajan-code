/**
 * harness-hooks — the TOOL gate (KJC-TSK-0710, from proposal KJC-PRP-0013).
 * Field case 2026-08-02: text rules were not enough — the environment must
 * impose them AT TOOL TIME. `kj harden` writes a PreToolUse script and wires
 * it into the project's `.claude/settings.json` (merged, never clobbered):
 * Write over an existing file blocks ("use Edit"), with no escape (ADR 0015).
 * Writes through Bash are the Sentinel's bash-write guard (KJC-BUG-0237), which
 * replaced the JSON-reserialization guard that lived here.
 * Claude-only v1 — the abstraction arrives with the second host that
 * supports tool hooks.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSea } from "node:sea";

// KJC-TSK-1204 (ADR 0030): the tool gate is a module of the package, like the
// Sentinel's guards, so kj-hook can run it from there.
const SCRIPT_BODY = readFileSync(new URL("./sentinel/pretooluse.mjs", import.meta.url), "utf8");

/** Write a managed hook script under .karajan/harness/ and return its path. */
/**
 * KJC-BUG-0211: el cuerpo canonico de los guardias que instala ESTE modulo,
 * para que quien verifica un sello pueda RECOMPUTAR en vez de fiarse del hash.
 */
export const HARNESS_BODIES = { "pretooluse.mjs": SCRIPT_BODY };

export function writeHarnessScript(projectDir, name, body) {
  const dir = join(projectDir, ".karajan", "harness");
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, name);
  writeFileSync(abs, body, { mode: 0o755 });
  return abs;
}

/**
 * KJC-TSK-1204 (ADR 0030): the hook runs the guard from the installed kj, never
 * a copy in the project. npm installs have kj-hook; the single-file kj, or an
 * install whose kj-hook is not on the PATH yet (a linked kj predating it), runs
 * it through `kj sentinel hook`, which exists wherever kj harden ran. Without
 * the runner, a hook before a tool blocks (no kj, no governance: the
 * maintainer's decision) and any other one warns.
 */
export const kjHookOnPath = () => spawnSync("sh", ["-c", "command -v kj-hook"], { stdio: "ignore" }).status === 0;

export function guardCommand(guard, { blocking = false, viaKj = isSea() || !kjHookOnPath() } = {}) {
  const [bin, run] = viaKj ? ["kj", `kj sentinel hook ${guard}`] : ["kj-hook", `kj-hook ${guard}`];
  const missing = `echo "karajan: ${bin} no está en el PATH — instala kj (npm i -g @karajan-family/code); sin él el Sentinel no gobierna esta sesión" >&2`;
  return `if command -v ${bin} >/dev/null 2>&1; then ${run}; else ${missing}${blocking ? "; exit 2" : ""}; fi`;
}

/** The wiring kj harden wrote before ADR 0030: node running the project's copy. */
const withoutLegacy = (list, script) => {
  const legacy = `node ${join(".karajan", "harness", script)}`;
  return list.flatMap((e) => {
    if (!Array.isArray(e?.hooks) || !e.hooks.some((h) => h?.command === legacy)) return [e];
    const hooks = e.hooks.filter((h) => h?.command !== legacy);
    return hooks.length ? [{ ...e, hooks }] : [];
  });
};

/**
 * KJC-TSK-1206 (ADR 0030): the wiring is what decides which guard runs, so it is
 * what gets verified. Every expected entry must call its guard, by the package
 * runner or by the old `node .karajan/harness/<script>`; `missing` names each
 * one that does not, and an unreadable settings file is missing everything.
 * "files" = some entry still runs the project's copies, so those copies are live
 * and verified as before; "wiring" = every entry runs the installed kj.
 */
export function wiringState({ projectDir, entries }) {
  let hooks;
  try {
    hooks = JSON.parse(readFileSync(join(projectDir, ".claude", "settings.json"), "utf8"))?.hooks;
  } catch {
    hooks = null;
  }
  if (!hooks || typeof hooks !== "object") return { mode: "wiring", missing: [".claude/settings.json (sin hooks legibles)"] };
  const missing = [];
  let legacy = false;
  for (const { event, matcher, script } of entries) {
    const guard = script.replace(/\.mjs$/, "");
    const runner = [true, false].map((viaKj) => guardCommand(guard, { blocking: event === "PreToolUse", viaKj }));
    const old = `node ${join(".karajan", "harness", script)}`;
    const here = (Array.isArray(hooks[event]) ? hooks[event] : []).filter((e) => e?.matcher === matcher).flatMap((e) => (Array.isArray(e?.hooks) ? e.hooks : []));
    if (here.some((h) => runner.includes(h?.command))) continue;
    if (here.some((h) => h?.command === old)) legacy = true;
    else missing.push(`${event} → ${guard}`);
  }
  return { mode: legacy ? "files" : "wiring", missing: [...new Set(missing)] };
}

/**
 * Merge hook entries into .claude/settings.json. Preserve, never clobber:
 * invalid JSON or a hook event with an unexpected (non-array) shape is the
 * user's business — the file is left alone and the caller wires manually.
 * entries: [{ event, matcher?, script }] where script is a .karajan/harness
 * basename; an entry is present when that script already appears under the
 * same event (and matcher, when given).
 */
export function mergeClaudeHooks({ projectDir, logger = console, entries }) {
  const settingsPath = join(projectDir, ".claude", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      logger.warn?.(`kj harden: ${settingsPath} is not valid JSON — leaving it untouched (hook scripts written, wire them manually)`);
      return { wired: false };
    }
  }
  settings.hooks = settings.hooks || {};
  for (const { event } of entries) {
    if (event in settings.hooks && !Array.isArray(settings.hooks[event])) {
      logger.warn?.(`kj harden: ${settingsPath} has a non-array hooks.${event} — leaving it untouched (hook scripts written, wire them manually)`);
      return { wired: false };
    }
  }
  const viaKj = isSea() || !kjHookOnPath();
  for (const { event, matcher, script } of entries) {
    const list = withoutLegacy(Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [], script);
    const command = guardCommand(script.replace(/\.mjs$/, ""), { blocking: event === "PreToolUse", viaKj });
    const present = list.some(
      (e) => (e?.hooks || []).some((h) => h?.command === command) && (matcher === undefined || e?.matcher === matcher),
    );
    if (!present) {
      const cmd = { type: "command", command };
      list.push(matcher === undefined ? { hooks: [cmd] } : { matcher, hooks: [cmd] });
    }
    settings.hooks[event] = list;
  }
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { wired: true };
}

/**
 * La raiz del proyecto: el toplevel de git, o el directorio dado si no hay git.
 * Vive aqui y no se importa de sentinel-hooks porque ese modulo importa de
 * este: el ciclo rompe la carga.
 */
function resolveProjectRoot(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || dir;
  } catch {
    return dir;
  }
}

/** The tool gate's place in the host settings. */
export const HARNESS_WIRING = [
  { event: "PreToolUse", matcher: "Write", script: "pretooluse.mjs" },
  { event: "PreToolUse", matcher: "Bash", script: "pretooluse.mjs" },
];

/**
 * Merge the tool gate's PreToolUse entries into .claude/settings.json. KJC-TSK-1208
 * (ADR 0030): the gate runs from the installed kj, so the copy an older kj wrote
 * into the project is retired once the hooks call the package's.
 */
export function installHarnessHooks({ projectDir = process.cwd(), logger = console } = {}) {
  // KJC-BUG-0223: el harness es del proyecto y vive en su raiz. Instalado desde
  // un subdirectorio sembraba ahi un segundo `.karajan/harness` que no gobierna
  // nada, y el gate seguia mirando otro sitio.
  const root = resolveProjectRoot(projectDir);
  if (root !== projectDir) logger?.info?.(`kj harden: el harness es del proyecto, se instala en su raíz (${root})`);
  projectDir = root;
  const { wired } = mergeClaudeHooks({ projectDir, logger, entries: HARNESS_WIRING });
  const copy = join(projectDir, ".karajan", "harness", "pretooluse.mjs");
  if (wired && existsSync(copy)) rmSync(copy);
  return { wired };
}
