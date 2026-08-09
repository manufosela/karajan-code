/**
 * board-select (KJC-TSK-0709) — never hu-board silently when alternatives
 * are reachable. Field case 2026-08-02: an install defaulted to hu-board
 * with the user's Planning Game MCP sitting configured and detectable.
 * Interactive installs ASK and persist the choice; headless installs name
 * the default and the exact line to change it. Declared = never asked.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";
import { detectAvailableBoards } from "./board-access.js";
import { getConfigPath, getProjectConfigPath } from "../config.js";

// "Declared" means the USER wrote state_backend in a config FILE — the
// merged config object always carries the hu-board default (defaults.js),
// so it can never tell a choice from a fallback.
async function declaredStateBackend(projectDir) {
  for (const p of [getProjectConfigPath(projectDir), getConfigPath()]) {
    try {
      const raw = parseYaml(await fs.readFile(p, "utf8")) || {};
      if (raw.state_backend) return { backend: raw.state_backend, boardName: raw.board?.name || null };
    } catch { /* missing or unreadable — keep looking */ }
  }
  return null;
}

async function persistStateBackend(projectDir, backend, boardName) {
  const configPath = getProjectConfigPath(projectDir);
  let source = "";
  try { source = await fs.readFile(configPath, "utf8"); } catch { /* no config yet — create it */ }
  const doc = parseDocument(source || "{}");
  doc.setIn(["state_backend"], backend);
  if (boardName) doc.setIn(["board", "name"], boardName);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, doc.toString(), "utf8");
  return configPath;
}

export async function pickStateBackend({ projectDir = process.cwd(), home = os.homedir(), env = process.env, wizard = null, isTTY = false, logger = console } = {}) {
  const declared = await declaredStateBackend(projectDir);
  if (declared) return { ...declared, source: "declared" };
  const boards = detectAvailableBoards({ projectDir, home, env });
  if (boards.length <= 1) return { backend: "hu-board", boardName: null, source: "default" };
  if (!wizard || !isTTY) {
    logger.info?.(`⚠ board: defaulting to the bundled HU Board, but this machine can reach: ${boards.slice(1).map((b) => b.label).join(", ")} — switch with \`state_backend: planning-game\` (or \`external\` + board.name) in .karajan/kj.config.yml and re-run kj env install`);
    return { backend: "hu-board", boardName: null, source: "default-informed" };
  }
  logger.info?.("Karajan needs a board (there is no 'none') — pick where card-first work lives:");
  const value = await wizard.select("Which board governs this project?", boards);
  const external = value.startsWith("external:");
  const backend = external ? "external" : value;
  const boardName = external ? value.slice("external:".length) : null;
  await persistStateBackend(projectDir, backend, boardName);
  const suffix = boardName ? ` (${boardName})` : "";
  logger.info?.(`✓ board: ${backend}${suffix} — persisted in .karajan/kj.config.yml`);
  return { backend, boardName, source: "chosen" };
}
