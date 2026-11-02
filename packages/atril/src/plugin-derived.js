/**
 * The derived plugin (ADR 0021, decision 14; ADR 0042): a plugin with hooks or MCP gets a Markdown-free copy
 * (manifest, hooks/hooks.json, .mcp.json) under <root>/plugins/<name>/derived, published in the local
 * marketplace atril owns at <root>/plugins/.marketplace. atril never runs a host CLI: it shows the command.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeAtomic } from "./atomic.js";
import { readJson } from "./plugin.js";
import { CLI_MATRIX } from "./plugin-compat.js";
import { wrapMcp } from "./plugin-normalize.js";
import { pluginPaths } from "./plugin-source.js";

const MARKETPLACE = "atril";
// Single-quoted for a POSIX shell, so a path with spaces or metacharacters stays one argument.
const q = (text) => `'${text.replaceAll("'", "'\\''")}'`;
// The CLIs with a plugin route (CLI_MATRIX runs hooks there) and the command each one is told to run.
const COMMANDS = {
  claude: ({ marketplace, name }) => `claude plugin marketplace add ${q(marketplace)} && claude plugin install ${q(`${name}@${MARKETPLACE}`)}`,
  agy: ({ path }) => `agy plugin install ${q(path)}`,
};

// A hook or MCP command that reaches into the plugin: its root variable, bin/ or node_modules.
const ASSET_REF = /\$\{?(?:CLAUDE_)?PLUGIN_ROOT\b|\bbin\/|node_modules/;

const writeJson =(path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
};

/**
 * Reconciles the derived plugin of a fetched copy and returns it; undefined when the plugin has no hooks and no
 * MCP, in which case a derived plugin left by an earlier version is removed with its marketplace entry.
 * @param {string} name @param {string} version @param {string} copy the fetched plugin
 * @param {{ root: string, hooks: number, mcpServers: number }} where `root` is the resolved atril root
 */
export function writeDerived(name, version, copy, { root, hooks, mcpServers }) {
  const { base } = pluginPaths(root, name, version); // throws on a name or version that would escape plugins/
  const path = join(base, "derived");
  const marketplace = join(root, "plugins", ".marketplace");
  const file = join(marketplace, ".claude-plugin", "marketplace.json");
  const derives = hooks > 0 || mcpServers > 0;
  rmSync(path, { recursive: true, force: true });
  const held = existsSync(file) ? readJson(file).plugins ?? [] : [];
  if (!derives && !held.some((entry) => entry.name === name)) return undefined;
  const plugins = held.filter((entry) => entry.name !== name);
  const written = [];
  if (derives) {
    writeJson(join(path, ".claude-plugin", "plugin.json"), { name, version });
    if (existsSync(join(copy, "hooks", "hooks.json"))) written.push({ rel: join("hooks", "hooks.json"), value: readJson(join(copy, "hooks", "hooks.json")) });
    if (existsSync(join(copy, ".mcp.json"))) written.push({ rel: ".mcp.json", value: wrapMcp(readJson(join(copy, ".mcp.json"))) });
    for (const { rel, value } of written) writeJson(join(path, rel), value);
    plugins.push({ name, source: `../${name}/derived` });
  }
  writeJson(file, { name: MARKETPLACE, owner: { name: MARKETPLACE }, plugins });
  if (!derives) return undefined;
  const args = { name, path: resolve(path), marketplace };
  const commands = Object.entries(COMMANDS).filter(([cli]) => CLI_MATRIX[cli]?.hooks).map(([cli, command]) => ({ cli, command: command(args) }));
  // The derived plugin carries no scripts, bin/ or node_modules (ADR 0042 route; no wrapper yet): a command that points at them breaks.
  const withoutAssets = ASSET_REF.test(JSON.stringify(written.map(({ value }) => value)));
  return { name, path: args.path, marketplace, commands, ...(withoutAssets && { withoutAssets }) };
}

/** Lines for the user: what the derived plugin is and the command per CLI. atril runs none of them. */
export function derivedInstructions({ name, marketplace, commands, withoutAssets }) {
  return [
    `derived plugin "${name}" (hooks and MCP) is published in ${marketplace}; to use it, run:`,
    ...commands.map(({ cli, command }) => `  ${cli}: ${command}`),
    ...(withoutAssets ? ["warning: without assets: its hooks or MCP reference scripts, bin/ or dependencies that the derived plugin does not include, so it may not work"] : []),
    "atril runs none of these and installs nothing at user level, so atril remove has nothing to undo for it",
  ];
}
