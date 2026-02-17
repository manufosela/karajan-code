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

function resolveKjHome() {
  if (process.env.KJ_HOME) return process.env.KJ_HOME;
  return path.join(ROOT_DIR, ".karajan");
}

async function resolveKjHomeFromRegistry() {
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
  return resolveKjHome();
}

async function setupClaudeMcp(kjHome) {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  let settings = {};
  try {
    settings = await readJson(settingsPath);
  } catch {
    settings = {};
  }

  settings.mcpServers = settings.mcpServers || {};
  settings.mcpServers["karajan-mcp"] = {
    command: "node",
    args: [path.join(ROOT_DIR, "src", "mcp", "server.js")],
    cwd: ROOT_DIR,
    env: { KJ_HOME: kjHome }
  };

  await writeJson(settingsPath, settings);
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
    `args = ["${path.join(ROOT_DIR, "src", "mcp", "server.js")}"]`,
    `cwd = "${ROOT_DIR}"`,
    '[mcp_servers."karajan-mcp".env]',
    `KJ_HOME = "${kjHome}"`
  ].join("\n");

  const updated = upsertCodexMcpBlock(toml, block);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, updated, "utf8");
}

async function main() {
  const kjHome = await resolveKjHomeFromRegistry();

  await setupClaudeMcp(kjHome);
  await setupCodexMcp(kjHome);

  console.log("karajan-mcp registered in Claude Code and Codex.");
}

main().catch(() => {
  // Silent failure — never block npm install
});
