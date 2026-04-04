// Chrome DevTools MCP detection and WebPerf skill auto-installation.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isOpenSkillsAvailable, installSkill, listSkills } from "../skills/openskills-client.js";

/** Skill names relevant for WebPerf analysis. Already installed globally via openskills. */
export const WEBPERF_SKILLS = [
  "optimize",
  "audit",
  "polish"
];

/**
 * Check whether Chrome DevTools MCP is configured and available.
 * Checks: (1) config flag, (2) Claude MCP config (~/.claude.json), (3) VS Code MCP settings.
 * @param {object} config - merged Karajan config
 * @returns {boolean}
 */
export function isDevToolsMcpAvailable(config) {
  // Explicit config flag takes priority
  if (config?.webperf?.devtools_mcp === true) return true;
  if (config?.webperf?.devtools_mcp === false) return false;

  // Check cached detection result
  if (_devToolsDetected !== null) return _devToolsDetected;

  // Not yet detected - return false (async detection runs at init)
  return false;
}

let _devToolsDetected = null;

/**
 * Auto-detect Chrome DevTools MCP from system configuration.
 * Checks ~/.claude.json and VS Code MCP settings.
 * Call once at pipeline init.
 */
export async function detectDevToolsMcp(logger) {
  // Check Claude MCP config
  const claudeConfigPath = path.join(os.homedir(), ".claude.json");
  try {
    const raw = await fs.readFile(claudeConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    const mcpServers = parsed?.mcpServers || parsed?.mcp_servers || {};
    if (mcpServers["chrome-devtools"] || mcpServers["chrome_devtools"]) {
      _devToolsDetected = true;
      logger?.info?.("Chrome DevTools MCP detected in ~/.claude.json");
      return true;
    }
  } catch { /* file not found or parse error */ }

  // Check VS Code MCP settings
  const vscodePaths = [
    path.join(os.homedir(), ".vscode", "settings.json"),
    path.join(process.cwd(), ".vscode", "settings.json")
  ];
  for (const vscPath of vscodePaths) {
    try {
      const raw = await fs.readFile(vscPath, "utf8");
      if (raw.includes("chrome-devtools") || raw.includes("chrome_devtools")) {
        _devToolsDetected = true;
        logger?.info?.(`Chrome DevTools MCP detected in ${vscPath}`);
        return true;
      }
    } catch { /* not found */ }
  }

  _devToolsDetected = false;
  return false;
}

/**
 * Ensure WebPerf skills are installed via OpenSkills.
 * Installs any missing skills from WEBPERF_SKILLS.
 * @param {string} projectDir - absolute path to the project root
 * @param {object} [logger] - optional logger ({ info, warn })
 * @returns {Promise<{ installed: string[], alreadyInstalled: string[], skipped: string[] }>}
 */
export async function ensureWebPerfSkills(projectDir, logger) {
  const result = { installed: [], alreadyInstalled: [], skipped: [] };

  const available = await isOpenSkillsAvailable();
  if (!available) {
    logger?.debug?.("OpenSkills CLI not available - WebPerf skills unavailable");
    result.skipped = [...WEBPERF_SKILLS];
    return result;
  }

  // List skills (includes global installs)
  const listResult = await listSkills({ projectDir });
  const installedNames = new Set(
    (listResult.ok ? listResult.skills : []).map(s => s.name)
  );

  for (const skill of WEBPERF_SKILLS) {
    if (installedNames.has(skill)) {
      result.alreadyInstalled.push(skill);
    } else {
      // Skills should be installed globally via `openskills install owner/repo`
      // Don't attempt auto-install with bare names — just note they're missing
      result.skipped.push(skill);
    }
  }

  if (result.alreadyInstalled.length > 0) {
    logger?.info?.(`WebPerf skills available: ${result.alreadyInstalled.join(", ")}`);
  }

  return result;
}
