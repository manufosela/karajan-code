/**
 * A plugin's path variables, filled in at install (ADR 0021 decision 14, plan step 13c3): the
 * absolute paths go into the staged copy that installPluginMarkdown() stores; `resolve` and
 * `route` never substitute. Only the body and `allowed-tools` are touched, as Claude Code does.
 */
import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { SAFE_NAME, readPluginManifest } from "./plugin.js";
import { resolveRoot } from "./scan.js";

const VARIABLE = /\$\{(CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|PLUGIN_DATA|CLAUDE_SKILL_DIR|user_config\.[A-Za-z_][A-Za-z0-9_]*)\}/g;
const DATA = /\$\{(?:CLAUDE_)?PLUGIN_DATA\}/;

/** Where a plugin keeps data that survives updates: outside the version folders, and no plugin name starts with ".". */
export function pluginDataDir(root, name) {
  if (typeof name !== "string" || !SAFE_NAME.test(name)) throw new Error(`plugin name "${name}" is not safe (lowercase letters, digits and dashes)`);
  return join(root, "plugins", ".data", name);
}

/**
 * Pure. A replacer function keeps `$&` or `$1` in a path literal. A variable with no value stays
 * as written and is reported; runtime, brace-less and shell variables are left unreported.
 * `${user_config.*}` waits for step 13c3 part ii: reported as undeclared.
 * @param {string} text
 * @param {Record<string, string>} values by variable name
 * @returns {{ text: string, unresolved: { variable: string, reason: string }[] }}
 */
export function substitutePluginVars(text, values) {
  const unresolved = [];
  const out = text.replace(VARIABLE, (whole, variable) => {
    if (variable.startsWith("user_config.")) unresolved.push({ variable, reason: "undeclared" });
    else if (Object.hasOwn(values, variable)) return values[variable];
    else unresolved.push({ variable, reason: "no value" });
    return whole;
  });
  return { text: out, unresolved };
}

/**
 * A `rewrite` hook for installPluginMarkdown(); `unresolved` fills up as { ref, variable, reason }.
 * The data folder is created when an entry names it and a rollback does not remove it.
 * @param {string} dir the plugin's cached copy
 * @param {{ root?: string, projectDir?: string, env?: object }} [opts] the store, as fetchPlugin() takes it
 */
export function pluginVarRewriter(dir, opts = {}) {
  const { name } = readPluginManifest(dir);
  const pluginRoot = realpathSync(dir);
  const data = pluginDataDir(resolve(opts.projectDir ?? process.cwd(), resolveRoot(opts)), name);
  const shared = { CLAUDE_PLUGIN_ROOT: pluginRoot, PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: data, PLUGIN_DATA: data };
  const unresolved = [];
  const rewrite = ({ entry, front, body }) => {
    const values = entry.kind === "skill" ? { ...shared, CLAUDE_SKILL_DIR: realpathSync(entry.path) } : shared;
    const fill = (text) => {
      if (DATA.test(text)) mkdirSync(data, { recursive: true });
      const done = substitutePluginVars(text, values);
      // A skill always has CLAUDE_SKILL_DIR, so an unfilled one belongs to a command or an agent.
      for (const { variable, reason } of done.unresolved) {
        unresolved.push({ ref: entry.ref, variable, reason: variable === "CLAUDE_SKILL_DIR" ? "skill-only" : reason });
      }
      return done.text;
    };
    const tools = front["allowed-tools"];
    const next = typeof tools === "string" ? { ...front, "allowed-tools": fill(tools) }
      : Array.isArray(tools) ? { ...front, "allowed-tools": tools.map((tool) => (typeof tool === "string" ? fill(tool) : tool)) }
        : front;
    return { front: next, body: fill(body) };
  };
  return { rewrite, unresolved };
}
