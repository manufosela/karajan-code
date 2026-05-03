/**
 * OpenSkills CLI availability check. Only runs when skills are enabled.
 * Strategy: prompt — we can offer to run `npm install -g openskills`,
 * but global installs are invasive enough that they need user consent.
 */

import { isOpenSkillsAvailable } from "../skills/openskills-client.js";
import { runCommand } from "../utils/process.js";
import { STRATEGY } from "./types.js";

function skillsEnabled(config) {
  return config?.skills?.enabled !== false;
}

/**
 * @internal Exported for dynamic import from tests/checks/skills.test.js
 * and tests/checks/auto-remediation-e2e.test.js. Knip false positive.
 */
export function createOpenSkillsCheck() {
  return {
    name: "openskills",
    label: "OpenSkills CLI",
    strategy: STRATEGY.PROMPT,
    applies: skillsEnabled,
    describe: "Install OpenSkills globally: npm install -g openskills",
    async detect() {
      const available = await isOpenSkillsAvailable();
      if (available) {
        return { ok: true, severity: "info", detail: "Available via `npx openskills`" };
      }
      return {
        ok: false,
        severity: "warn", // skills enabled but missing → degrade gracefully
        detail: "`npx openskills` not available — skill injection will be skipped",
        fix: "Install OpenSkills: npm install -g openskills",
      };
    },
    async remediate() {
      const res = await runCommand("npm", ["install", "-g", "openskills"], { timeout: 60000 });
      if (res.exitCode === 0) {
        return { fixed: true, detail: "Installed openskills globally via npm" };
      }
      return {
        fixed: false,
        detail: `npm install -g openskills failed (exit ${res.exitCode}): ${res.stderr.split("\n")[0]}`,
      };
    },
  };
}

export function getSkillsChecks() {
  return [createOpenSkillsCheck()];
}
