/**
 * The hooks and MCP servers of a plugin as canonical `.rulesync/` entries (ADR 0041). `rulesync import` runs on a
 * throwaway copy of the plugin, in a throwaway working directory, so it never touches the project's `.rulesync/`
 * nor the cache. A sensitive `user_config` key stays a reference (`${KEY}`): no value is ever read here.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { declaredPluginConfig } from "./plugin-config.js";
import { lossyFields, prepareImport, splitLossy } from "./plugin-normalize.js";
import { defaultRun, runRulesync } from "./rulesync-cli.js";

const readKind = (root, kind) => {
  const name = [`${kind}.jsonc`, `${kind}.json`].find((file) => existsSync(join(root, ".rulesync", file)));
  return name ? JSON.parse(readFileSync(join(root, ".rulesync", name), "utf8")) : undefined;
};

// `${user_config.KEY}` of a sensitive key becomes `${KEY}`; anything else stays as the import produced it.
const referSecrets = (value, keys) => JSON.parse(keys.reduce((text, key) => text.replaceAll(`\${user_config.${key}}`, `\${${key}}`), JSON.stringify(value)));

const RUNNERS = new Set(["node", "python", "python3", "bash", "sh", "bun", "tsx"]);

// A `./` path of the plugin as the same file in its copy in the store, relative to the project; one that climbs out with `..` is refused.
// The word may be wrapped in one pair of quotes, which stay. A store path the shell would split or expand is refused: no quoting is invented.
// A path the plugin does not ship is the project's: it stays as it is and is added to `kept`, so the install can say so.
const refuseEscape = (path) => { if (path.split("/").includes("..")) throw new Error(`${JSON.stringify(path)} escapes the plugin`); };

function inCopy(word, { base, ships, kept }) {
  const [, open, path, close] = /^(["']?)(\.\/.*?)(["']?)$/.exec(word);
  refuseEscape(path);
  if (!ships(path.slice(2))) { kept.push(path); return word; }
  if (/[\s"'`$\\;&|<>()*?]/.test(base)) throw new Error(`the plugin copy path ${JSON.stringify(base)} needs shell quoting: use a store path without spaces or shell characters`);
  return `${open}${base}/${path.slice(2)}${close}`;
}

// The `cwd` of an MCP server follows the same rule as a `./` path: a relative one the plugin ships becomes its copy in the store, one it does not ship stays the project's.
// Absolute, home and variable paths are not ours. The `..` check comes before the disk is looked at.
function cwdInCopy(cwd, { base, ships, kept }) {
  if (typeof cwd !== "string" || /^([/~$\\]|[A-Za-z]:)/.test(cwd)) return cwd;
  refuseEscape(cwd);
  const path = cwd.split("/").filter((part) => part && part !== ".").join("/");
  if (!path) return base;
  if (!ships(path)) { kept.push(cwd); return cwd; }
  return `${base}/${path}`;
}

const isPluginPath = (word) => /^["']?\.\//.test(word ?? "");
const HAS_PLUGIN_PATH = /(^|[\s"'=;&|(<>])\.\//;

// Only the plugin's files move: the command word, and the script right after a known runner. Options between the
// runner and a `./` path cannot be told from their values without guessing, so that command is refused.
function rewriteWords(words, to) {
  const text = words.join(" ");
  const unquoted = text.replace(/"[^"]*"|'[^']*'/g, '""');
  if (HAS_PLUGIN_PATH.test(text) && (/&&|\|\||[;|]|^\s*[A-Za-z_]\w*=/.test(unquoted) || /(^|\s)(sh|bash)\s+-c\s/.test(text))) {
    throw new Error(`this command mixes ./ paths with shell syntax the rewrite does not follow: ${text}; write one command per hook, with no VAR=value prefix, ; && || | or sh -c, or use a command with no ./ path`);
  }
  const out = [...words];
  if (isPluginPath(words[0])) out[0] = inCopy(words[0], to);
  else if (RUNNERS.has(words[0]) && isPluginPath(words[1])) out[1] = inCopy(words[1], to);
  else if (RUNNERS.has(words[0]) && words[1]?.startsWith("-") && words.some(isPluginPath)) {
    throw new Error(`this command cannot be pointed to the store: ${words.join(" ")}; write it without options before the script`);
  }
  return out;
}

// The words of a command line are told apart by any run of whitespace, which is kept as it was.
function rewriteCommand(command, to) {
  const parts = command.split(/(\s+)/);
  const at = parts.flatMap((part, i) => (part && !/^\s+$/.test(part) ? [i] : []));
  rewriteWords(at.map((i) => parts[i]), to).forEach((word, k) => { parts[at[k]] = word; });
  return parts.join("");
}

// Decides per hook entry and per MCP server: one that cannot be pointed to the store is dropped from `canonical` and
// listed in `skipped` with the reason; the others are rewritten in place.
function pointToCopy(canonical, base, ships) {
  const skipped = [];
  const kept = [];
  let rewritten = false;
  // `fn` gets the `to` of its entry; the paths it left to the project are named only if the entry stays.
  const attempt = (kind, name, fn) => {
    const paths = [];
    try {
      rewritten = fn({ base, ships, kept: paths }) || rewritten;
      kept.push(...paths.map((path) => ({ kind, name, path })));
      return true;
    } catch (error) { skipped.push({ kind, name, reason: error.message }); return false; }
  };
  const hooks = canonical.hooks?.hooks ?? {};
  for (const [event, entries] of Object.entries(hooks)) {
    hooks[event] = entries.filter((entry) => typeof entry.command !== "string" || attempt("hook", `${event}: ${entry.command}`, (to) => {
      const command = rewriteCommand(entry.command, to);
      const changed = command !== entry.command;
      entry.command = command;
      return changed;
    }));
    if (!hooks[event].length) delete hooks[event];
  }
  const servers = canonical.mcp?.mcpServers ?? {};
  for (const [name, server] of Object.entries(servers)) {
    if (typeof server.command !== "string") continue;
    const before = JSON.stringify(server);
    const ok = attempt("mcp", name, (to) => {
      const cwd = server.cwd === undefined ? undefined : cwdInCopy(server.cwd, to);
      // The server starts in its new cwd, so the paths of its command are written from there: they still name the plugin's file.
      const up = cwd === server.cwd ? to.base : cwd.slice(to.base.length).split("/").filter(Boolean).map(() => "..").join("/") || ".";
      const words = rewriteWords([server.command, ...(server.args ?? [])], { ...to, base: up });
      server.command = words[0];
      if (server.args) server.args = words.slice(1);
      if (cwd !== undefined) server.cwd = cwd;
      return JSON.stringify(server) !== before;
    });
    if (!ok) delete servers[name];
  }
  if (skipped.length) for (const [kind, entries] of [["hooks", hooks], ["mcp", servers]]) if (canonical[kind] && !Object.keys(entries).length) delete canonical[kind];
  return { rewritten, skipped, kept };
}

/**
 * `pluginCopy` is where the plugin lives in the store: the `./` script paths the import left (they would point to the
 * project) become paths to that copy, and `rewritten` says so, so the caller can ask the team to commit the store.
 * A `./` path the plugin does not ship is the project's: it is left as it is and named in `kept`.
 * A hook or MCP server that cannot be pointed to the copy is left out of `canonical` and named in `skipped`.
 * `lossy` names the harmless fields the import dropped; one that changes what runs leaves all entries out (`skipped`, kind "plugin").
 * @returns {{ status: "absent" } | { status: "imported", canonical: { mcp?: object, hooks?: object }, needs?: string[], rewritten?: true, kept?: { kind: "hook" | "mcp", name: string, path: string }[], skipped?: { kind: "hook" | "mcp", name: string, reason: string }[] }} absent: rulesync does not answer; needs: sensitive keys the entries refer to as `${KEY}`
 * @throws when the import itself fails; the temporary directory is removed either way
 */
export function importCanonical(pluginDir, { projectDir, pluginCopy }, run = defaultRun) {
  try { runRulesync(["--version"], { projectDir }, run); } catch { return { status: "absent" }; }
  const tmp = mkdtempSync(join(tmpdir(), "atril-import-"));
  try {
    const copy = join(tmp, "plugin");
    cpSync(pluginDir, copy, { recursive: true, filter: (path) => !/[\\/](node_modules|\.git|\.rulesync)$/.test(path) });
    prepareImport(copy);
    runRulesync(["import", "--targets", "claudecode-plugin", "--features", "mcp,hooks", "--output-root", copy], { projectDir, cwd: tmp }, run);
    const secrets = declaredPluginConfig(pluginDir).filter(({ sensitive }) => sensitive).map(({ key }) => key);
    const canonical = {};
    for (const kind of ["mcp", "hooks"]) {
      const doc = readKind(copy, kind);
      if (doc) canonical[kind] = referSecrets(doc, secrets);
    }
    // A lost field that changes when or how an entry runs keeps every hook and MCP entry of the plugin out (the host CLI keeps them whole).
    const { harmless, blocking } = splitLossy(lossyFields(pluginDir));
    if (blocking.length) for (const kind of Object.keys(canonical)) delete canonical[kind];
    const ships = (path) => existsSync(join(pluginDir, path)); // `..` was refused before this runs: the check stays inside the plugin
    const { rewritten, skipped, kept } = pluginCopy ? pointToCopy(canonical, `./${relative(projectDir, pluginCopy).split(sep).join("/")}`.replace(/^\.\/\.\./, ".."), ships) : { skipped: [], kept: [] };
    if (blocking.length) skipped.push({ kind: "plugin", name: "hooks and MCP servers", reason: `the import loses ${[...new Set(blocking.map(({ field }) => field))].join(", ")}, which change when or how they run` });
    const lossy = blocking.length ? [] : harmless.map(({ field, where }) => ({ field, where }));
    const text = JSON.stringify(canonical);
    const needs = secrets.filter((key) => text.includes(`\${${key}}`)); // the variables the user must have: names only, never a value
    return { status: "imported", canonical, ...(needs.length && { needs }), ...(rewritten && { rewritten }), ...(kept.length && { kept }), ...(lossy.length && { lossy }), ...(skipped.length && { skipped }) };
  } catch (error) {
    throw new Error(`rulesync import failed (${error.message}); nothing was installed`, { cause: error });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
