/**
 * The hooks and MCP servers of a plugin as canonical `.rulesync/` entries (ADR 0041). `rulesync import` runs on a
 * throwaway copy of the plugin, in a throwaway working directory, so it never touches the project's `.rulesync/`
 * nor the cache. A sensitive `user_config` key stays a reference (`${KEY}`): no value is ever read here.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { declaredPluginConfig } from "./plugin-config.js";
import { prepareImport } from "./plugin-normalize.js";
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
function inCopy(word, base) {
  const [, open, path, close] = /^(["']?)(\.\/.*?)(["']?)$/.exec(word);
  if (path.split("/").includes("..")) throw new Error(`${JSON.stringify(path)} escapes the plugin`);
  if (/[\s"'`$\\;&|<>()*?]/.test(base)) throw new Error(`the plugin copy path ${JSON.stringify(base)} needs shell quoting: use a store path without spaces or shell characters`);
  return `${open}${base}/${path.slice(2)}${close}`;
}

const isPluginPath = (word) => /^["']?\.\//.test(word ?? "");
const HAS_PLUGIN_PATH = /(^|[\s"'=;&|(<>])\.\//;

// Only the plugin's files move: the command word, and the script right after a known runner. Options between the
// runner and a `./` path cannot be told from their values without guessing, so that command is refused.
function rewriteWords(words, base) {
  const text = words.join(" ");
  const unquoted = text.replace(/"[^"]*"|'[^']*'/g, '""');
  if (HAS_PLUGIN_PATH.test(text) && (/&&|\|\||[;|]|^\s*[A-Za-z_]\w*=/.test(unquoted) || /(^|\s)(sh|bash)\s+-c\s/.test(text))) {
    throw new Error(`this command mixes ./ paths with shell syntax the rewrite does not follow: ${text}; write one command per hook, with no VAR=value prefix, ; && || | or sh -c, or use a command with no ./ path`);
  }
  const out = [...words];
  if (isPluginPath(words[0])) out[0] = inCopy(words[0], base);
  else if (RUNNERS.has(words[0]) && isPluginPath(words[1])) out[1] = inCopy(words[1], base);
  else if (RUNNERS.has(words[0]) && words[1]?.startsWith("-") && words.some(isPluginPath)) {
    throw new Error(`this command cannot be pointed to the store: ${words.join(" ")}; write it without options before the script`);
  }
  return out;
}

// The words of a command line are told apart by any run of whitespace, which is kept as it was.
function rewriteCommand(command, base) {
  const parts = command.split(/(\s+)/);
  const at = parts.flatMap((part, i) => (part && !/^\s+$/.test(part) ? [i] : []));
  rewriteWords(at.map((i) => parts[i]), base).forEach((word, k) => { parts[at[k]] = word; });
  return parts.join("");
}

// Decides per hook entry and per MCP server: one that cannot be pointed to the store is dropped from `canonical` and
// listed in `skipped` with the reason; the others are rewritten in place.
function pointToCopy(canonical, base) {
  const skipped = [];
  let rewritten = false;
  const attempt = (kind, name, fn) => {
    try { rewritten = fn() || rewritten; return true; } catch (error) { skipped.push({ kind, name, reason: error.message }); return false; }
  };
  const hooks = canonical.hooks?.hooks ?? {};
  for (const [event, entries] of Object.entries(hooks)) {
    hooks[event] = entries.filter((entry) => typeof entry.command !== "string" || attempt("hook", `${event}: ${entry.command}`, () => {
      const command = rewriteCommand(entry.command, base);
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
    const ok = attempt("mcp", name, () => {
      const words = rewriteWords([server.command, ...(server.args ?? [])], base);
      server.command = words[0];
      if (server.args) server.args = words.slice(1);
      return JSON.stringify(server) !== before;
    });
    if (!ok) delete servers[name];
  }
  if (skipped.length) for (const [kind, entries] of [["hooks", hooks], ["mcp", servers]]) if (canonical[kind] && !Object.keys(entries).length) delete canonical[kind];
  return { rewritten, skipped };
}

/**
 * `pluginCopy` is where the plugin lives in the store: the `./` script paths the import left (they would point to the
 * project) become paths to that copy, and `rewritten` says so, so the caller can ask the team to commit the store.
 * A hook or MCP server that cannot be pointed to the copy is left out of `canonical` and named in `skipped`.
 * @returns {{ status: "absent" } | { status: "imported", canonical: { mcp?: object, hooks?: object }, needs?: string[], rewritten?: true, skipped?: { kind: "hook" | "mcp", name: string, reason: string }[] }} absent: rulesync does not answer; needs: sensitive keys the entries refer to as `${KEY}`
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
    const { rewritten, skipped } = pluginCopy ? pointToCopy(canonical, `./${relative(projectDir, pluginCopy).split(sep).join("/")}`.replace(/^\.\/\.\./, "..")) : { skipped: [] };
    const text = JSON.stringify(canonical);
    const needs = secrets.filter((key) => text.includes(`\${${key}}`)); // the variables the user must have: names only, never a value
    return { status: "imported", canonical, ...(needs.length && { needs }), ...(rewritten && { rewritten }), ...(skipped.length && { skipped }) };
  } catch (error) {
    throw new Error(`rulesync import failed (${error.message}); nothing was installed`, { cause: error });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
