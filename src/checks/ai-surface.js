/**
 * ai-surface — MCP inventory with drift detection (KJC-TSK-0694).
 *
 * Every new tool an agent gains is one more access. An inventory nobody
 * reconciles is "the feeling of control without the control", so kj check
 * flags what APPEARED since the last run and asks the user to own it.
 * A nudge, never a gate. ~/.claude.json is scoped to its global block plus
 * THIS project's entry — other projects' MCPs are not reachable here.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const sources = (projectDir, home) => [
  { file: path.join(projectDir, ".mcp.json"), format: "json" },
  { file: path.join(home, ".claude.json"), format: "json" },
  { file: path.join(home, ".codex", "config.toml"), format: "toml" },
  { file: path.join(home, ".gemini", "settings.json"), format: "json" },
];

function jsonServerNames(text, projectDir) {
  try {
    const parsed = JSON.parse(text);
    const names = new Set(Object.keys(parsed.mcpServers || {}));
    for (const name of Object.keys(parsed.projects?.[projectDir]?.mcpServers || {})) names.add(name);
    return names;
  } catch {
    return new Set();
  }
}

const tomlServerNames = (text) =>
  new Set([...text.matchAll(/^\s*\[mcp_servers\.["']?([^\]"']+)["']?\]/gm)].map((m) => m[1]));

/** Sorted `name (config-file)` entries for every MCP reachable in this project. */
export function collectAiSurface({ projectDir = process.cwd(), home = os.homedir() } = {}) {
  const surface = new Set();
  for (const { file, format } of sources(projectDir, home)) {
    if (!existsSync(file)) continue;
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const names = format === "toml" ? tomlServerNames(text) : jsonServerNames(text, projectDir);
    for (const name of names) surface.add(`${name} (${path.basename(file)})`);
  }
  return [...surface].sort();
}

/**
 * Diff the current surface against the last-seen snapshot and persist the
 * new state. First run records the baseline silently.
 */
export function checkAiSurface({ projectDir = process.cwd(), home = os.homedir(), statePath = path.join(os.homedir(), ".karajan", "ai-surface.json") } = {}) {
  const surface = collectAiSurface({ projectDir, home });
  let state = {};
  try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* first run or corrupt → baseline */ }
  const prev = Array.isArray(state[projectDir]) ? state[projectDir] : null;
  const added = prev ? surface.filter((e) => !prev.includes(e)) : [];
  const removed = prev ? prev.filter((e) => !surface.includes(e)) : [];
  state[projectDir] = surface;
  try {
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch { /* read-only FS — inventory still reports, just cannot remember */ }
  return { surface, added, removed, first: !prev };
}

/** One line for kj check output. */
export function formatAiSurface({ surface, added, removed, first }) {
  const head = `ai surface: ${surface.length} MCP(s)`;
  if (first) return `${head} — baseline recorded`;
  const parts = [head];
  if (added.length) parts.push(`NEW since last check: ${added.join(", ")} — approved by you?`);
  if (removed.length) parts.push(`gone: ${removed.join(", ")}`);
  return parts.join(" · ");
}
