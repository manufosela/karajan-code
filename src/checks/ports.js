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
import { STRATEGY } from "./types.js";

const DEFAULT_SONAR_PORT = 9000;
const DEFAULT_HU_BOARD_PORT = 4000;

function extractPortFromHost(host, fallback) {
  const m = String(host || "").match(/:(\d+)(?:\/|$)/);
  return m ? Number(m[1]) : fallback;
}

/**
 * Whether the occupant looks like the Karajan-managed Sonar container.
 * Docker Desktop's proxy is typically `com.docker.backend` / `com.docker.vmnetd`
 * on macOS and `docker-proxy` on Linux. We treat those as OK.
 */
function isKarajanSonarOccupant(occupant) {
  if (!occupant?.command) return false;
  const cmd = occupant.command.toLowerCase();
  return cmd.includes("docker") || cmd.includes("sonar");
}

export function createSonarPortCheck() {
  return {
    name: "port:sonar",
    label: "SonarQube port",
    strategy: STRATEGY.MANUAL,
    // Returns { applies, reason } so the runner shows WHY when skipped.
    // Common cause of confusion: a global ~/.karajan/kj.config.yml with
    // `sonarqube.enabled: false` silently disables every sonar check —
    // the user thinks Karajan is broken, when it's just respecting their
    // config.
    applies: (config) => {
      if (config?.sonarqube?.enabled === false) {
        return { applies: false, reason: "sonarqube.enabled is false in kj.config.yml — set true to enable Sonar (Karajan auto-starts the docker container)" };
      }
      if (config?.sonarqube?.external === true) {
        return { applies: false, reason: "sonarqube.external is true — port managed outside Karajan" };
      }
      return true;
    },
    async detect({ config }) {
      const port = extractPortFromHost(config?.sonarqube?.host, DEFAULT_SONAR_PORT);
      const free = await isPortAvailable(port);
      if (free) {
        return { ok: true, severity: "info", detail: `Port ${port} is free (Sonar container not yet running)` };
      }
      // Busy — is it our container?
      const occupant = await getPortOccupant(port);
      if (occupant && isKarajanSonarOccupant(occupant)) {
        return {
          ok: true,
          severity: "info",
          detail: `Port ${port} held by Karajan-managed Sonar (${occupant.command} PID ${occupant.pid})`,
        };
      }
      const who = occupant
        ? `${occupant.command || "unknown"} (PID ${occupant.pid ?? "?"})`
        : "unknown process";
      return {
        ok: false,
        severity: "fail",
        detail: `Port ${port} occupied by ${who}`,
        fix: `Stop the process holding port ${port} or change sonarqube.host in kj.config.yml.`,
        extra: { port, occupant },
      };
    },
  };
}

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
