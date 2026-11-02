// What a plugin runs, listed before it is installed (ADR 0021 decision 14, step 13g2-i). Pure: it only
// reads files under `dir`; every string was written by the plugin, so formatInventory quotes and escapes it.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import yaml from "js-yaml";
import { FRONTMATTER, isMapping } from "./model.js";
import { listPluginMarkdown, readJson, readPluginManifest } from "./plugin.js";
import { npmLockfile } from "./plugin-deps.js";
import { countServers, wrapMcp } from "./plugin-normalize.js";
import { substitutePluginVars } from "./plugin-vars.js";

const HOOK_FIELDS = new Map(Object.entries({
  command: ["command", "args", "shell"], http: ["url"], mcp_tool: ["server", "tool"], prompt: ["prompt"], agent: ["prompt"],
}));

const outside = (root, path) => {
  const rel = relative(root, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
};

// The default file, then each manifest value (a path or an inline value), in Claude Code's load order.
const declared = (dir, manifest, key, defaultFile) => {
  const root = realpathSync(dir);
  const load = (path) => { // a symlink in the copy must not make the listing read a file outside it
    if (outside(root, realpathSync(path))) throw new Error(`${shown(relative(dir, path))} escapes the plugin (symlink)`);
    return readJson(path);
  };
  const items = existsSync(join(dir, defaultFile)) ? [{ source: defaultFile, value: load(join(dir, defaultFile)), file: true }] : [];
  const own = manifest[key];
  for (const item of Array.isArray(own) ? own : [own].filter((value) => value !== undefined)) {
    const quoted = shown(item);
    if (isMapping(item)) items.push({ source: "plugin.json", value: item, manifest: true });
    else if (typeof item !== "string") throw new Error(`plugin.json: ${key} must be a path or an object, got ${quoted}`);
    else {
      const path = resolve(dir, item);
      if (outside(dir, path)) throw new Error(`plugin.json: ${quoted} escapes the plugin`);
      if (!existsSync(path)) throw new Error(`plugin.json: ${quoted} not found`);
      items.push({ source: relative(dir, path), value: load(path), file: true, manifest: true });
    }
  }
  return items;
};

// hookEntries (hook.js) rejects the hooks a manifest declares and every hook of a Codex plugin: say so.
const NOT_INSTALLED = "not installed: declared in plugin.json";
const NATIVE_ONLY = "not installed: codex plugins are native-only";

const hookItems = ({ source, value, file, manifest }, format) => {
  const status = format === "codex" ? NATIVE_ONLY : manifest ? NOT_INSTALLED : undefined;
  const events = file ? value?.hooks : value;
  if (!isMapping(events)) throw new Error(`${shown(source)}: needs ${file ? 'a top-level "hooks" object' : "an event map"}`);
  return Object.entries(events).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [null]).flatMap((group) => {
    if (!Array.isArray(group?.hooks) || !group.hooks.every(isMapping)) throw new Error(`${shown(source)}: ${shown(event)} needs groups of { matcher, hooks: [handler] }`);
    return group.hooks.map((handler) => {
      const fields = HOOK_FIELDS.get(handler.type);
      const detail = fields ? Object.fromEntries(fields.filter((field) => field in handler).map((field) => [field, handler[field]])) : { raw: JSON.stringify(handler) };
      return { source, event, matcher: group.matcher, type: handler.type, ...detail, ...(status && { status }) };
    });
  }));
};

const mcpItems = ({ source, value, file }) => {
  const wrapped = file ? value : { mcpServers: value };
  countServers(wrapped);
  return Object.entries(wrapMcp(wrapped).mcpServers).map(([name, server]) => ({
    source, name, type: server.type ?? (server.url ? "http" : "stdio"), command: server.command, args: server.args,
    env: Object.keys(server.env ?? {}), url: server.url, headersHelper: server.headersHelper,
  }));
};

// The runtime packages `npm ci --omit=dev` would install, with whether the install can run at all.
const npmInventory = (dir) => {
  const { status, reason } = npmLockfile(dir);
  if (status === "none") return { status, packages: [] };
  const manifest = readJson(join(dir, "package.json"));
  // `npm ci` lets an optional entry override a runtime one of the same name.
  const byName = new Map(["dependencies", "optionalDependencies"].flatMap((field) => Object.entries(manifest[field] ?? {})));
  const packages = [...byName].map(([name, range]) => ({ name, range })).toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { status, ...(reason && { reason }), packages };
};

// The variables the install leaves as written: the same surface it substitutes (body and allowed-tools),
// keeping what it never fills: `user_config.*` and, outside a skill, CLAUDE_SKILL_DIR.
const unfilled = (dir) => {
  const root = realpathSync(dir);
  return listPluginMarkdown(dir).flatMap(({ kind, ref, path }) => {
    const file = kind === "skill" ? join(path, "SKILL.md") : path;
    if (outside(root, realpathSync(file))) throw new Error(`${shown(relative(dir, file))} escapes the plugin (symlink)`);
    const match = FRONTMATTER.exec(readFileSync(file, "utf8").replace(/^\u{FEFF}/u, ""));
    if (!match) return [];
    const texts = [match[2], ...[yaml.load(match[1])?.["allowed-tools"]].flat().filter((tool) => typeof tool === "string")];
    return texts.flatMap((text) => substitutePluginVars(text, {}).unresolved)
      .filter(({ variable }) => variable.startsWith("user_config.") || (variable === "CLAUDE_SKILL_DIR" && kind !== "skill"))
      .map(({ variable, reason }) => ({ ref, variable, reason: variable === "CLAUDE_SKILL_DIR" ? "skill-only" : reason }));
  });
};

/** { name, version, format, hooks, mcpServers, bin, npm, variables } for a fetched copy; throws, naming the file, on anything unreadable. */
export function pluginInventory(dir) {
  const { name, version, format, manifest } = readPluginManifest(dir);
  return {
    name, version, format, npm: npmInventory(dir), variables: unfilled(dir),
    hooks: declared(dir, manifest, "hooks", join("hooks", "hooks.json")).flatMap((item) => hookItems(item, format)),
    mcpServers: declared(dir, manifest, "mcpServers", ".mcp.json").flatMap(mcpItems),
    bin: existsSync(join(dir, "bin")) ? readdirSync(join(dir, "bin")).toSorted().map((file) => `bin/${file}`) : [],
  };
}

// JSON quoting, then the code points JSON leaves raw: DEL and C1, bidi, zero-width and line separators.
const RAW = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const hex = (c) => (c.codePointAt(0) > 0xffff ? `\\u{${c.codePointAt(0).toString(16)}}` : `\\u${c.codePointAt(0).toString(16).padStart(4, "0")}`);
const shown = (value) => JSON.stringify(typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))).replace(RAW, hex);
const show = (value) => (Array.isArray(value) ? value.map(shown).join(" ") : shown(value));
const section = (title, items, keys, note = "") => [
  items.length ? `${title} (${items.length}${note}):` : `${title}: none`,
  ...items.map((item) => `  ${keys.filter((key) => item[key] !== undefined).map((key) => `${key} ${show(item[key])}`).join(" ")}`),
];

/** The listing as lines with a trailing newline; `source` and `commit` are state.json's. */
export function formatInventory({ name, version, format, hooks, mcpServers, bin, npm, variables }, { source, commit } = {}) {
  const from = source ? ` from ${shown(source.repo ?? source.url ?? source.path)} at ${shown(`${String(commit ?? "").slice(0, 12)}…`)}` : "";
  return `${[
    `plugin ${name} ${shown(version ?? "")} (${format})${from}`,
    ...section("hooks", hooks, ["event", "matcher", "type", "status", "command", "args", "shell", "url", "server", "tool", "prompt", "raw", "source"]),
    ...section("mcp servers", mcpServers, ["name", "type", "command", "args", "env", "url", "headersHelper", "source"]),
    ...section("executables on PATH (bin/)", bin.map((file) => ({ file })), ["file"]),
    ...section("npm packages", npm.packages, ["name", "range"]),
    ...(npm.reason ? [`  not installed: ${shown(npm.reason)}`] : []),
    ...section("unresolved variables", variables, ["ref", "variable", "reason"]),
  ].join("\n")}\n`;
}
