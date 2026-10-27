/**
 * Plugin normalization around `rulesync import` (ADR 0021, plan step 13b1). The
 * import is not lossless: a flat .mcp.json imports as zero servers, and hooks.json
 * `modules` and the hook fields rewakeMessage / rewakeSummary are dropped. So the
 * plugin's cached copy is normalized before the import (flat MCP wrapped), and the
 * server count is kept for the caller to check after it. Reporting the hooks.json
 * losses is the next piece of this step, not this one.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { isMapping } from "./model.js";

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
