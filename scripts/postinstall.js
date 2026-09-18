#!/usr/bin/env node
/**
 * postinstall hook – registers karajan-mcp in Claude Code and Codex
 * automatically after `npm install`.
 *
 * - Non-interactive, silent on success.
 * - Idempotent: safe to run many times.
 * - Never fails hard (exits 0 even on error) so `npm install` is not blocked.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tomlPath } from "./toml-value.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(os.homedir(), ".karajan", "instances.json");

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

const CLAUDE_JSON_PATH = path.join(os.homedir(), ".claude.json");

// KJC-BUG-0179 (#1730): a home INSIDE the npm package is the old default
// this script wrote itself — wiped on every reinstall, never where `kj init`
// stores kj.config.yml. Such a value is stale, not a user choice.
// KJC-BUG-0181: in a linked install (npm link, source tree) the package does
// not live under node_modules, so THIS package's own `.karajan` is the same
// stale default under another path — compared as a path, not a pattern.
const isPackageDirHome = (home) => /node_modules[\\/]karajan-code[\\/]\.karajan[\\/]?$/.test(home)
  || path.resolve(home) === path.join(ROOT_DIR, ".karajan");

/** The home a previous registration carried, if the user (not this script) set it. */
function homeFromExistingEntry(entry) {
  const previous = entry?.env?.KARAJAN_HOME || entry?.env?.KJ_HOME;
  return previous && !isPackageDirHome(previous) ? previous : null;
}

/**
 * Precedence: KARAJAN_HOME → KJ_HOME (deprecated) → the existing entry's home
 * → the instances registry → `~/.karajan` (where the CLI defaults, KJC-BUG-0179).
 */
async function resolveKjHome(existingEntry) {
  if (process.env.KARAJAN_HOME) return process.env.KARAJAN_HOME;
  if (process.env.KJ_HOME) return process.env.KJ_HOME;
  const previous = homeFromExistingEntry(existingEntry);
  if (previous) return previous;
  try {
    const registry = await readJson(REGISTRY_PATH);
    const names = Object.keys(registry.instances || {});
    if (names.length > 0) {
      const first = registry.instances[names.includes("default") ? "default" : names[0]];
      if (first?.kjHome) return first.kjHome;
    }
  } catch {
    // No registry yet — use default
  }
  return path.join(os.homedir(), ".karajan");
}

async function readClaudeConfig() {
  try {
    return await readJson(CLAUDE_JSON_PATH);
  } catch {
    return {};
  }
}

async function setupClaudeMcp(config, kjHome) {
  config.mcpServers = config.mcpServers || {};
  // Keep every env key the user added to the entry; only the home is ours,
  // and it is written under the current name (KJ_HOME is deprecated).
  const { KJ_HOME: _stale, ...userEnv } = config.mcpServers["karajan-mcp"]?.env || {};
  config.mcpServers["karajan-mcp"] = {
    type: "stdio",
    command: "node",
    args: [path.join(ROOT_DIR, "src", "mcp", "server.js")],
    cwd: ROOT_DIR,
    env: { ...userEnv, KARAJAN_HOME: kjHome }
  };

  await writeJson(CLAUDE_JSON_PATH, config);
}

function upsertCodexMcpBlock(toml, block) {
  const begin = "# BEGIN karajan-mcp";
  const end = "# END karajan-mcp";
  const startIdx = toml.indexOf(begin);
  const endIdx = toml.indexOf(end);
  let base = toml;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    base = `${toml.slice(0, startIdx).trimEnd()}\n\n${toml.slice(endIdx + end.length).trimStart()}`;
  }

  return `${base.trimEnd()}\n\n${begin}\n${block}\n${end}\n`;
}

async function setupCodexMcp(kjHome) {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  let toml = "";
  try {
    toml = await fs.readFile(configPath, "utf8");
  } catch {
    toml = "";
  }

  const block = [
    '[mcp_servers."karajan-mcp"]',
    'command = "node"',
    `args = [${tomlPath(path.join(ROOT_DIR, "src", "mcp", "server.js"))}]`,
    `cwd = ${tomlPath(ROOT_DIR)}`,
    '[mcp_servers."karajan-mcp".env]',
    `KARAJAN_HOME = ${tomlPath(kjHome)}`
  ].join("\n");

  const updated = upsertCodexMcpBlock(toml, block);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, updated, "utf8");
}

async function main() {
  const claudeConfig = await readClaudeConfig();
  const kjHome = await resolveKjHome(claudeConfig.mcpServers?.["karajan-mcp"]);

  await setupClaudeMcp(claudeConfig, kjHome);
  await setupCodexMcp(kjHome);

  console.log("karajan-mcp registered in Claude Code and Codex.");
}

main().catch(() => {
  // Silent failure — never block npm install
});
