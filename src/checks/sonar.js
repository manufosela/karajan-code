/**
 * SonarQube reachability + auth checks.
 *
 * Auto-remediation strategy (preserving existing behavior from
 * preflight-checks.js): if Sonar is not reachable, try `sonarUp()` which
 * starts the Docker container, then poll for readiness. If auth fails but
 * admin credentials exist, generate a fresh token and persist it.
 */

import { isSonarReachable } from "../sonar/manager.js";
import { STRATEGY } from "./types.js";
import { withDocLink } from "../utils/doc-links.js";

/** Which config switch turns Sonar off, or null when none does. */
function disabledSwitch(config) {
  if (config.sonarqube?.enabled === false) return "sonarqube.enabled: false";
  if (config.review_gate?.sonar === false) return "review_gate.sonar: false";
  return null;
}

function sonarHost(config) {
  return config.sonarqube?.host || "http://localhost:9000";
}

/**
 * Informative check: Sonar enabled/disabled status.
 * Produces an OK result with disabled description when Sonar is off.
 */
function createSonarStatusCheck() {
  return {
    name: "sonarqube",
    label: "SonarQube",
    strategy: STRATEGY.NONE,
    async detect({ config }) {
      const host = sonarHost(config);
      // KJC-TSK-0838 (ADR 2026-09-13): Sonar switched off is a DEFECT, not a
      // preference — the commit gate rejects code diffs without a sonar
      // proof, so this config only hurts. Only docs-only diffs are exempt.
      const off = disabledSwitch(config);
      if (off) {
        return {
          ok: false,
          severity: "fail",
          detail: `Disabled in config (${off}) — Sonar is mandatory for code; the commit gate rejects code diffs without a sonar proof`,
          fix: withDocLink(`Set sonarqube.enabled: true and drop review_gate.sonar: false; a laptop without Docker runs 'kj sonar start'. Only a human grant (kj policy grant --rule method.sonar.code) lifts the gate.`, "sonar_docker"),
        };
      }
      let reachable;
      try {
        reachable = await isSonarReachable(host);
      } catch {
        reachable = false;
      }
      return {
        ok: reachable,
        severity: "fail",
        detail: reachable ? `Reachable at ${host}` : `Not reachable at ${host}`,
        fix: reachable
          ? undefined
          : withDocLink(
              "Run 'kj sonar start' or 'docker start karajan-sonarqube'. Use --no-sonar to skip.",
              "sonar_docker"
            ),
        extra: { host, reachable },
      };
    },
  };
}

/**
 * All Sonar-related checks. Keeps just the status check for commit 1;
 * auth + auto-remediation are layered in commit 3.
 */
export function getSonarChecks() {
  return [createSonarStatusCheck()];
}
