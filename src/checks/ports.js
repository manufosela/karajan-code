/**
 * Port availability checks for services Karajan controls.
 *
 *   - SonarQube port (default 9000): the Docker container binds a fixed port,
 *     so if it's occupied by a non-Karajan process we cannot "move" it; we
 *     report FAIL with the occupant PID/command to help the user stop the
 *     conflicting process. Strategy: manual.
 *
 *   - HU Board port (default 4000): an in-process Node server we can rebind
 *     to any free port in runtime overrides. Strategy: auto.
 */

import { isPortAvailable, findAvailablePort } from "../utils/port-check.js";
import { getPortOccupant } from "../utils/port-occupant.js";
import { discoverRunningSonar } from "../sonar/discovery.js";
import { isSonarReachable } from "../sonar/manager.js";
import { STRATEGY } from "./types.js";

const DEFAULT_SONAR_PORT = 9000;
const DEFAULT_HU_BOARD_PORT = 4000;

function extractPortFromHost(host, fallback) {
  const m = String(host || "").match(/:(\d+)(?:\/|$)/);
  return m ? Number(m[1]) : fallback;
}

/**
 * @internal Exported for dynamic import from tests/checks/ports.test.js
 * and tests/checks/auto-remediation-e2e.test.js. Knip false positive.
 */
export function createSonarPortCheck() {
  return {
    name: "port:sonar",
    label: "SonarQube port",
    // AUTO since v2.7.5 — Karajan now resolves SonarQube discovery on
    // its own. If a Sonar container is running anywhere (any name, any
    // image tag), point Karajan at it. If port 9000 is occupied by
    // someone non-Sonar, rebind to the next free port. Asking the user
    // to "stop the unknown process" was busywork.
    strategy: STRATEGY.AUTO,
    applies: (config) => {
      if (config?.sonarqube?.external === true) {
        return { applies: false, reason: "sonarqube.external is true — port managed outside Karajan" };
      }
      return true;
    },
    describe: "Discover or rebind SonarQube port (no user action needed)",
    async detect({ config }) {
      const configuredPort = extractPortFromHost(config?.sonarqube?.host, DEFAULT_SONAR_PORT);

      // Step 1 — is there ANY running SonarQube container we can reuse?
      // Container name doesn't matter; we just need a published host port
      // that responds to /api/system/status. This avoids "port 9000 is
      // taken by an unknown process" errors when the unknown process is
      // actually a perfectly good SonarQube from another project.
      const discovered = await discoverRunningSonar();
      if (discovered.found && discovered.reachable) {
        // If the discovered host matches what's already configured,
        // there's nothing to fix — happy path.
        if (discovered.port === configuredPort) {
          return {
            ok: true,
            severity: "info",
            detail: `Reusing running SonarQube container "${discovered.containerName}" on port ${discovered.port}`,
          };
        }
        // Otherwise we want to rewrite the host config at runtime.
        return {
          ok: false,
          severity: "warn",
          detail: `Found running SonarQube container "${discovered.containerName}" on port ${discovered.port} (config points at ${configuredPort})`,
          extra: { remap: { host: discovered.host, port: discovered.port, container: discovered.containerName } },
        };
      }

      // Step 2 — no running container. Is the configured port even free?
      const free = await isPortAvailable(configuredPort);
      if (free) {
        return {
          ok: true,
          severity: "info",
          detail: `Port ${configuredPort} is free (Sonar container will be started on demand)`,
        };
      }

      // Step 3 — port is busy. Maybe the occupant IS Sonar but not
      // discovered by `docker ps` (rare: bare-metal Sonar, host-network
      // container, etc.). HTTP-probe to find out.
      const probeHost = `http://localhost:${configuredPort}`;
      if (await isSonarReachable(probeHost)) {
        return {
          ok: true,
          severity: "info",
          detail: `Port ${configuredPort} held by a Sonar instance (HTTP /api/system/status responds) — reusing it`,
        };
      }

      // Step 4 — really not Sonar. Find an alternate free port and tell
      // the runtime to use it. The compose template's published port is
      // hardcoded at 9000 so we can't auto-rebind the container itself,
      // but we CAN warn loudly with a clear, fixable message.
      const occupant = await getPortOccupant(configuredPort);
      const alt = await findAvailablePort(configuredPort + 1, 20);
      if (alt) {
        return {
          ok: false,
          severity: "warn",
          detail: `Port ${configuredPort} occupied by ${occupant?.command || "unknown"} (PID ${occupant?.pid ?? "?"}). Will rebind Karajan-managed Sonar to ${alt}.`,
          extra: { remap: { host: `http://localhost:${alt}`, port: alt, fromPort: configuredPort } },
        };
      }
      // Last-resort failure (no free port in the next 20).
      return {
        ok: false,
        severity: "fail",
        detail: `Port ${configuredPort} occupied by ${occupant?.command || "unknown"} (PID ${occupant?.pid ?? "?"}) and no free port in ${configuredPort + 1}..${configuredPort + 20}`,
        fix: "Stop the conflicting process or set sonarqube.host in kj.config.yml.",
      };
    },
    async remediate({ extra }) {
      if (!extra?.remap) {
        return { fixed: false, detail: "No remap available" };
      }
      const { host, container, fromPort } = extra.remap;
      const detail = container
        ? `Pointed Karajan at running SonarQube ${container} (${host})`
        : `Rebound Karajan-managed Sonar from port ${fromPort} to ${host}`;
      return {
        fixed: true,
        detail,
        // The runner merges this into the runtime config so every
        // downstream Sonar caller (scanner, manager, MCP handler) sees
        // the new host without the user touching kj.config.yml.
        changes: { sonarqube: { host } },
      };
    },
  };
}

/**
 * @internal Exported for dynamic import from tests/checks/ports.test.js
 * and tests/checks/auto-remediation-e2e.test.js. Knip false positive.
 */
export function createHuBoardPortCheck() {
  return {
    name: "port:hu-board",
    label: "HU Board port",
    strategy: STRATEGY.AUTO,
    applies: (config) => {
      if (config?.hu_board?.enabled === false) {
        return { applies: false, reason: "hu_board.enabled is false in kj.config.yml — HU Board dashboard skipped" };
      }
      return true;
    },
    describe: "Rebind HU Board to the next free port",
    async detect({ config }) {
      const port = config?.hu_board?.port || DEFAULT_HU_BOARD_PORT;
      const free = await isPortAvailable(port);
      if (free) {
        return { ok: true, severity: "info", detail: `Port ${port} is free` };
      }
      const occupant = await getPortOccupant(port);
      const who = occupant
        ? `${occupant.command || "unknown"} (PID ${occupant.pid ?? "?"})`
        : "unknown process";
      return {
        ok: false,
        severity: "warn",
        detail: `Port ${port} occupied by ${who}`,
        fix: `Free port ${port} or set hu_board.port in kj.config.yml`,
        extra: { port, occupant },
      };
    },
    async remediate({ extra }) {
      const start = (extra?.port ?? DEFAULT_HU_BOARD_PORT) + 1;
      const found = await findAvailablePort(start, 20);
      return {
        fixed: true,
        detail: `Rebound HU Board to port ${found} (in-memory override)`,
        changes: { hu_board: { port: found } },
      };
    },
  };
}

export function getPortChecks() {
  return [createSonarPortCheck(), createHuBoardPortCheck()];
}
