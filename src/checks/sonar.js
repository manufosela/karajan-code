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

/**
 * Whether Sonar is enabled in the active config.
 */
function sonarEnabled(config) {
  return config.sonarqube?.enabled !== false;
}

function sonarHost(config) {
  return config.sonarqube?.host || "http://localhost:9000";
}

/**
 * Informative check: Sonar enabled/disabled status.
 * Produces an OK result with disabled description when Sonar is off.
 */
export function createSonarStatusCheck() {
  return {
    name: "sonarqube",
    label: "SonarQube",
    strategy: STRATEGY.NONE,
    async detect({ config }) {
      const host = sonarHost(config);
      if (!sonarEnabled(config)) {
        return { ok: true, severity: "info", detail: "Disabled in config" };
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
