/**
 * Plugin normalization around `rulesync import` (ADR 0021, plan step 13b1). The
 * import is not lossless: a flat .mcp.json imports as zero servers, and hooks.json
 * `modules` and the hook fields rewakeMessage / rewakeSummary are dropped. So the
 * plugin's cached copy is normalized before the import (flat MCP wrapped), and the
 * server count is kept for the caller to check after it. lossyFields reports what
 * the import would still drop, so the caller can keep such a plugin native-only.
 * normalizePlugin (step 13b2) runs the import itself and checks the server count after it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeAtomic } from "./atomic.js";
import { isMapping } from "./model.js";
import { detectPluginFormat, readPluginManifest } from "./plugin.js";
import { defaultRun, runRulesync } from "./rulesync-cli.js";
// The ADR names only these two import targets; Codex is unverified, so it stays native-only.
const IMPORT_TARGETS = { claude: "claudecode-plugin", agent: "antigravity-plugin" };
const HOOKS_FILE = join("hooks", "hooks.json");
const HOOK_LOSSY = ["rewakeMessage", "rewakeSummary"];
// The ADR marks inline hooks / mcpServers in plugin.json "untested": lossy until verified.
const MANIFEST_LOSSY = ["hooks", "mcpServers"];


// A top-level "mcpServers" key means wrapped, so a flat server with that name reads as wrapped and fails loudly.
const servers = (mcp) => {
  if (!isMapping(mcp)) throw new Error(".mcp.json must be a JSON object");
  if (!("mcpServers" in mcp)) return mcp;
  if (Object.keys(mcp).length > 1) throw new Error(".mcp.json: mcpServers next to other keys is neither flat nor wrapped");
  if (!isMapping(mcp.mcpServers)) throw new Error(".mcp.json: mcpServers must be an object");
  return mcp.mcpServers;
};

export function countServers(mcp) {
  const entries = Object.entries(servers(mcp));
  const invalid = entries.find(([, entry]) => !isMapping(entry));
  if (invalid) throw new Error(`.mcp.json: server "${invalid[0]}" must be an object`);
  return entries.length;
}

export const wrapMcp = (mcp) => (servers(mcp) === mcp ? { mcpServers: { ...mcp } } : mcp);

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: invalid JSON (${error.message})`, { cause: error });
  }
};

/** Wraps a flat <dir>/.mcp.json in place; `dir` is the cached copy, never the user's source. */
export function prepareImport(dir) {
  const path = join(dir, ".mcp.json");
  if (!existsSync(path)) return { servers: 0, wrapped: false };
  const mcp = readJson(path);
  const count = countServers(mcp);
  const flat = !("mcpServers" in mcp);
  if (flat) writeAtomic(path, `${JSON.stringify(wrapMcp(mcp), null, 2)}\n`);
  return { servers: count, wrapped: flat };
}
// Every rewake field on any object under `value`, with its path; conservative, so one under `env` counts too.
const findHookFields = (value, where) => {
  if (Array.isArray(value)) return value.flatMap((item, index) => findHookFields(item, `${where}[${index}]`));
  if (!isMapping(value)) return [];
  const own = HOOK_LOSSY.filter((field) => field in value).map((field) => ({ file: HOOKS_FILE, field, where }));
  return [...own, ...Object.entries(value).flatMap(([key, item]) => findHookFields(item, `${where}.${key}`))];
};

// Code-unit order, not locale order, so the list is the same on every machine.
const byCodeUnit = (x, y) => (x < y ? -1 : Number(x > y));
const compare = (a, b) => byCodeUnit(a.file, b.file) || byCodeUnit(a.where, b.where) || byCodeUnit(a.field, b.field);

/** What `rulesync import` would lose, as [{ file, field, where }]; empty means the import is safe. */
export function lossyFields(dir) {
  const { format, manifest } = readPluginManifest(dir);
  // A string value is a path to a file, not inline config.
  const lost = MANIFEST_LOSSY.filter((field) => isMapping(manifest[field]))
    .map((field) => ({ file: "plugin.json", field, where: `${format} manifest` }));
  const hooksPath = join(dir, HOOKS_FILE);
  if (existsSync(hooksPath)) {
    const hooks = readJson(hooksPath);
    if (!isMapping(hooks)) throw new Error(`${hooksPath}: hooks.json must be a JSON object`);
    if ("modules" in hooks) lost.push({ file: HOOKS_FILE, field: "modules", where: "modules" });
    lost.push(...findHookFields(hooks.hooks, "hooks"));
  }
  return lost.toSorted(compare);
}

/**
 * Imports the cached copy `dir` into `<dir>/.rulesync` (ADR 0021). Run it on a freshly fetched copy only.
 * The binary is resolved from `projectDir`, never from the copy. A plugin the import cannot keep whole
 * is returned as native-only (a choice for the install step), not thrown.
 */
export function normalizePlugin(dir, { projectDir = process.cwd() } = {}, run = defaultRun) {
  const target = IMPORT_TARGETS[detectPluginFormat(dir)];
  if (!target) return { status: "native-only", reason: "no rulesync import target for .codex-plugin" };
  const lossy = lossyFields(dir);
  if (lossy.length) return { status: "native-only", reason: "rulesync import would drop fields", lossy };
  const abs = resolve(dir);
  const source = join(abs, ".rulesync");
  if (existsSync(source)) throw new Error(`${source} already exists; normalize a freshly fetched copy`);
  const { servers, wrapped } = prepareImport(abs);
  try {
    // cwd stays projectDir: the `npx --no-install` fallback resolves local bins from cwd, and the copy is untrusted.
    runRulesync(["import", "--targets", target, "--output-root", abs], { projectDir }, run);
  } catch (error) {
    throw new Error(`rulesync import failed for ${dir} (${error.message})`, { cause: error });
  }
  const imported = join(source, "mcp.json");
  const after = existsSync(imported) ? countServers(readJson(imported)) : 0;
  if (after !== servers) throw new Error(`${dir}: rulesync import changed the MCP server count (${servers} → ${after})`);
  return { status: "split", source, target, servers, wrapped };
}
