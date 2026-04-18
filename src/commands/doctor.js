/**
 * `kj doctor` command. Runs the unified check runner and prints a
 * human-readable report.
 *
 * Internal helpers have been extracted to src/checks/* modules during
 * KJC-TSK-0319. This file remains the thin CLI adapter.
 */

import { runChecks as runCheckPipeline, toLegacyShape } from "../checks/runner.js";
import { getSystemChecks } from "../checks/system.js";
import { getConfigFileChecks } from "../checks/config-files.js";
import { getBinaryChecks } from "../checks/binaries.js";
import { getSonarChecks } from "../checks/sonar.js";
import { getCiChecks } from "../checks/ci.js";
import { getRtkChecks } from "../checks/rtk.js";
import { getNodeChecks } from "../checks/node.js";
import { getPortChecks } from "../checks/ports.js";
import { getTokenChecks } from "../checks/tokens.js";
import { getMcpHealthChecks } from "../checks/mcp-health.js";
import { getSkillsChecks } from "../checks/skills.js";
import { getDirSetupChecks } from "../checks/dir-setup.js";

/**
 * Build the list of Check objects applicable to the current config.
 * @param {Object} config
 * @returns {import("../checks/types.js").Check[]}
 */
function buildChecks(config) {
  return [
    ...getSystemChecks(),
    ...getNodeChecks(),
    ...getDirSetupChecks(),
    ...getConfigFileChecks(),
    ...getBinaryChecks(),
    ...getSonarChecks(),
    ...getPortChecks(),
    ...getTokenChecks(config),
    ...getMcpHealthChecks(),
    ...getSkillsChecks(),
    ...getCiChecks(),
    ...getRtkChecks(),
  ];
}

/**
 * Run all environment checks and return results in the legacy shape expected
 * by existing consumers: `{ name, label, ok, detail, fix }`.
 *
 * Kept public so tools and tests can consume the raw list without CLI output.
 *
 * @param {{ config: Object }} args
 * @returns {Promise<Array<{ name: string, label: string, ok: boolean, detail: string, fix: string|null }>>}
 */
export async function runChecks({ config }) {
  const checks = buildChecks(config);
  const report = await runCheckPipeline(checks, { config });
  return toLegacyShape(report);
}

/**
 * `kj doctor` CLI entrypoint. Prints each check's status and any fix hints.
 * Returns the flattened check list for programmatic consumption.
 *
 * @param {{ config: Object }} args
 */
export async function doctorCommand({ config }) {
  const checks = await runChecks({ config });

  for (const check of checks) {
    const icon = check.ok ? "OK  " : "MISS";
    console.log(`${icon} ${check.label}: ${check.detail}`);
    if (check.fix) {
      console.log(`     -> ${check.fix}`);
    }
  }

  const failures = checks.filter((c) => !c.ok && c.fix);
  if (failures.length === 0) {
    console.log("\nAll checks passed.");
  } else {
    console.log(`\n${failures.length} issue(s) found.`);
  }

  return checks;
}
