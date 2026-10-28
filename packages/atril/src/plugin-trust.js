// What a plugin runs, listed before it is installed (ADR 0021 decision 14, step 13g2-i). Pure: it only
// reads files under `dir`; every string was written by the plugin, so formatInventory quotes and escapes it.
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isMapping } from "./model.js";
import { readJson, readPluginManifest } from "./plugin.js";
import { countServers, wrapMcp } from "./plugin-normalize.js";

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
    if (isMapping(item)) items.push({ source: "plugin.json", value: item });
    else if (typeof item !== "string") throw new Error(`plugin.json: ${key} must be a path or an object, got ${quoted}`);
    else {
      const path = resolve(dir, item);
      if (outside(dir, path)) throw new Error(`plugin.json: ${quoted} escapes the plugin`);
      if (!existsSync(path)) throw new Error(`plugin.json: ${quoted} not found`);
      items.push({ source: relative(dir, path), value: load(path), file: true });
    }
  }
  return items;
};

const hookItems = ({ source, value, file }) => {
  const events = file ? value?.hooks : value;
  if (!isMapping(events)) throw new Error(`${shown(source)}: needs ${file ? 'a top-level "hooks" object' : "an event map"}`);
  return Object.entries(events).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [null]).flatMap((group) => {
    if (!Array.isArray(group?.hooks) || !group.hooks.every(isMapping)) throw new Error(`${shown(source)}: ${shown(event)} needs groups of { matcher, hooks: [handler] }`);
    return group.hooks.map((handler) => {
      const fields = HOOK_FIELDS.get(handler.type);
      const detail = fields ? Object.fromEntries(fields.filter((field) => field in handler).map((field) => [field, handler[field]])) : { raw: JSON.stringify(handler) };
      return { source, event, matcher: group.matcher, type: handler.type, ...detail };
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

/** { name, version, format, hooks, mcpServers, bin } for a fetched copy; throws, naming the file, on anything unreadable. */
export function pluginInventory(dir) {
  const { name, version, format, manifest } = readPluginManifest(dir);
  return {
    name, version, format,
    hooks: declared(dir, manifest, "hooks", join("hooks", "hooks.json")).flatMap(hookItems),
    mcpServers: declared(dir, manifest, "mcpServers", ".mcp.json").flatMap(mcpItems),
    bin: existsSync(join(dir, "bin")) ? readdirSync(join(dir, "bin")).toSorted().map((file) => `bin/${file}`) : [],
  };
}

// JSON quoting, then the code points JSON leaves raw: DEL and C1, bidi, zero-width and line separators.
const RAW = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const hex = (c) => (c.codePointAt(0) > 0xffff ? `\\u{${c.codePointAt(0).toString(16)}}` : `\\u${c.codePointAt(0).toString(16).padStart(4, "0")}`);
const shown = (value) => JSON.stringify(typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))).replace(RAW, hex);
const show = (value) => (Array.isArray(value) ? value.map(shown).join(" ") : shown(value));
const section = (title, items, keys) => [
  items.length ? `${title} (${items.length}):` : `${title}: none`,
  ...items.map((item) => `  ${keys.filter((key) => item[key] !== undefined).map((key) => `${key} ${show(item[key])}`).join(" ")}`),
];

/** The listing as lines with a trailing newline; `source` and `commit` are state.json's. */
export function formatInventory({ name, version, format, hooks, mcpServers, bin }, { source, commit } = {}) {
  const from = source ? ` from ${shown(source.repo ?? source.url ?? source.path)} at ${shown(`${String(commit ?? "").slice(0, 12)}…`)}` : "";
  return `${[
    `plugin ${name} ${shown(version ?? "")} (${format})${from}`,
    ...section("hooks", hooks, ["event", "matcher", "type", "command", "args", "shell", "url", "server", "tool", "prompt", "raw", "source"]),
    ...section("mcp servers", mcpServers, ["name", "type", "command", "args", "env", "url", "headersHelper", "source"]),
    ...section("executables on PATH (bin/)", bin.map((file) => ({ file })), ["file"]),
  ].join("\n")}\n`;
}
