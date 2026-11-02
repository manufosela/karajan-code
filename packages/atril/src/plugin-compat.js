// What each CLI could receive of a plugin (ADR 0021, decision 14, step 13h). Pure: it reads the plugin's
// inventory and Markdown, not what atril installs today (hooks and MCP wait for ADR 0041).
import { listPluginMarkdown } from "./plugin.js";
import { pluginInventory } from "./plugin-trust.js";

// The table of truth, from .karajan/adrs/0021-…md lines 287-297 ("Compatibility is computed, not assumed").
// A part is true (all of it), false (none), null (the ADR does not say) or, for hooks, the events it runs.
//   claude   - lines 275-276: bin/, LSP, monitors and userConfig exist only on Claude Code.
//   agy      - lines 289-291: only preToolUse, postToolUse, stop (and model-invocation events the ADR does not
//              name, so not listed here); no commands; no bin/.
//   opencode - lines 294-297: plugin hooks are incompatible; the Markdown half works on demand.
// MCP reaches every target through rulesync (lines 246-247); npm runs in the cached copy of a plugin-route CLI
// (lines 305-306), and the ADR says nothing of it on opencode. Codex, Cursor, Copilot, … are not in the table.
export const CLI_MATRIX = {
  claude: { skills: true, commands: true, agents: true, hooks: true, mcp: true, bin: true, npm: true },
  agy: { skills: true, commands: false, agents: true, hooks: ["preToolUse", "postToolUse", "stop"], mcp: true, bin: false, npm: true },
  opencode: { skills: true, commands: true, agents: true, hooks: false, mcp: true, bin: false, npm: null },
};
const UNKNOWN_CLIS = ["codex", "cursor", "copilot"];

const canonical = (event) => `${event[0].toLowerCase()}${event.slice(1)}`; // PreToolUse → preToolUse

const entry = (support, items) => {
  const total = items.length;
  if (support === null) return { total, received: 0, status: "unknown" };
  const received = items.filter(({ event }) => support === true || (Array.isArray(support) && support.includes(canonical(event)))).length;
  return { total, received, status: received === 0 ? "none" : received === total ? "all" : "partial" };
};

/** { name, clis: [{ cli, parts }], unknown } where each part is { total, received, status: all|partial|none|unknown }. */
export function compatReport(dir) {
  const inventory = pluginInventory(dir);
  const markdown = listPluginMarkdown(dir);
  const kinds = (kind) => markdown.filter((item) => item.kind === kind);
  const items = {
    skills: kinds("skill"), commands: kinds("command"), agents: kinds("agent"), hooks: inventory.hooks,
    mcp: inventory.mcpServers, bin: inventory.bin, npm: inventory.npm.packages,
  };
  const clis = Object.entries(CLI_MATRIX).map(([cli, support]) => ({
    cli,
    parts: Object.fromEntries(Object.entries(items).map(([part, list]) => [part, entry(support[part], list)])),
  }));
  return { name: inventory.name, clis, unknown: UNKNOWN_CLIS };
}

/** The report as lines with a trailing newline. */
export function formatCompat({ name, clis, unknown }) {
  return `${[
    `plugin ${name}`,
    ...clis.flatMap(({ cli, parts }) => [cli, ...Object.entries(parts).map(([part, { total, received, status }]) => `  ${part} ${received}/${total} ${status}`)]),
    `unknown: ${unknown.join(", ")}`,
  ].join("\n")}\n`;
}
