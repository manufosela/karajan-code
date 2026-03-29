/**
 * Chrome DevTools MCP detection and WebPerf skill auto-installation.
 */

import { isOpenSkillsAvailable, installSkill, listSkills } from "../skills/openskills-client.js";

/** Skill names to auto-install when WebPerf is enabled. */
export const WEBPERF_SKILLS = [
  "webperf",
  "webperf-core-web-vitals",
  "webperf-loading"
];

/**
 * Check whether Chrome DevTools MCP is configured and available.
 * Since Karajan runs as an MCP server itself, it cannot directly call other MCPs.
 * Instead, we check the config flag `webperf.devtools_mcp`.
 * @param {object} config — merged Karajan config
 * @returns {boolean}
 */
export function isDevToolsMcpAvailable(config) {
  return Boolean(config?.webperf?.devtools_mcp);
}

/**
 * Ensure WebPerf skills are installed via OpenSkills.
 * Installs any missing skills from WEBPERF_SKILLS.
 * @param {string} projectDir — absolute path to the project root
 * @param {object} [logger] — optional logger ({ info, warn })
 * @returns {Promise<{ installed: string[], alreadyInstalled: string[], skipped: string[] }>}
 */
export async function ensureWebPerfSkills(projectDir, logger) {
  const result = { installed: [], alreadyInstalled: [], skipped: [] };

  const available = await isOpenSkillsAvailable();
  if (!available) {
    logger?.warn?.("OpenSkills CLI not available — skipping WebPerf skill installation");
    result.skipped = [...WEBPERF_SKILLS];
    return result;
  }

  // Get currently installed skills
  const listResult = await listSkills({ projectDir });
  const installedNames = new Set(
    (listResult.ok ? listResult.skills : []).map(s => s.name)
  );

  for (const skill of WEBPERF_SKILLS) {
    if (installedNames.has(skill)) {
      result.alreadyInstalled.push(skill);
      continue;
    }

    const installResult = await installSkill(skill, { projectDir });
    if (installResult.ok) {
      result.installed.push(skill);
      logger?.info?.(`Installed WebPerf skill: ${skill}`);
    } else {
      result.skipped.push(skill);
      logger?.warn?.(`Failed to install WebPerf skill "${skill}": ${installResult.error}`);
    }
  }

  return result;
}
