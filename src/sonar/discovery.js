/**
 * Discover running SonarQube containers regardless of the user's
 * config. The point: never bother the user about port 9000 being
 * "occupied by an unknown process" — if there's a Sonar already up
 * somewhere, just point at it and move on.
 *
 * The previous preflight check insisted on owning port 9000 by name
 * (`karajan-sonarqube`). If you happened to have a `sonarqube` from
 * another project running on 9000 (or had pulled a different image
 * tag), we'd error out asking the user to "stop the conflicting
 * process". That's busywork — Sonar is Sonar; reuse what's there.
 *
 * The discovery strategy:
 *   1. List Docker containers whose image looks like sonarqube
 *      (image-name regex / ancestor filter — covers `sonarqube`,
 *      `sonarqube:community`, `sonarqube:lts`, `sonarqube:9.9`, …).
 *   2. Parse the published host port (`0.0.0.0:9001->9000/tcp`).
 *   3. Optionally HTTP-probe to confirm it's actually serving
 *      `/api/system/status` so a misnamed image can't hijack us.
 */

import { runCommand } from "../utils/process.js";
import { isSonarReachable } from "./manager.js";
import { escapeRegExp } from "../utils/escape-regexp.js";

/**
 * @typedef {Object} DiscoveredSonar
 * @property {boolean} found
 * @property {string} [containerName]
 * @property {string} [image]
 * @property {number} [port]    - host port (what we connect to)
 * @property {string} [host]    - http://localhost:<port>
 * @property {boolean} [reachable] - true after a successful HTTP probe
 */

/**
 * Parse the Ports column from `docker ps`. Looks for any host binding
 * that maps to the container's `internalPort` (default 9000).
 * Examples:
 *   "0.0.0.0:9000->9000/tcp"        → 9000
 *   "127.0.0.1:9001->9000/tcp"      → 9001
 *   "9000/tcp"                      → null (no host binding)
 *   "0.0.0.0:9000->9000/tcp, 9092/tcp" → 9000
 *
 * @param {string} portsStr
 * @param {number} [internalPort=9000]
 * @returns {number|null}
 */
export function extractHostPort(portsStr, internalPort = 9000) {
  if (!portsStr) return null;
  const re = new RegExp(
    `(?:0\\.0\\.0\\.0|127\\.0\\.0\\.1|::|\\[::\\]):(\\d+)\\s*->\\s*${escapeRegExp(internalPort)}\\/tcp`,
    "g"
  );
  const matches = [...portsStr.matchAll(re)];
  if (matches.length === 0) return null;
  // Prefer the smallest port number (likeliest the "main" binding);
  // arbitrary but deterministic.
  return Math.min(...matches.map((m) => Number(m[1])));
}

/**
 * Run `docker ps` with a list-of-images filter and parse the result.
 * Returns the FIRST container with a usable host port, or null.
 *
 * @returns {Promise<DiscoveredSonar|null>}
 */
async function dockerPsForSonar() {
  // List all running containers with their image so we can image-match
  // ourselves. Cheap (single docker call) and tolerant of image tags.
  const res = await runCommand("docker", [
    "ps",
    "--format", "{{.ID}}|{{.Names}}|{{.Image}}|{{.Ports}}",
  ]);
  if (res.exitCode !== 0 || !res.stdout?.trim()) return null;

  const lines = res.stdout.trim().split("\n");
  for (const line of lines) {
    const [, name, image, ports] = line.split("|");
    if (!image) continue;
    if (!/sonarqube/i.test(image)) continue;
    const port = extractHostPort(ports, 9000);
    if (!port) continue;
    return {
      found: true,
      containerName: name,
      image,
      port,
      host: `http://localhost:${port}`,
    };
  }
  return null;
}

/**
 * Public entry point: find a usable, reachable Sonar.
 *
 * `probe`: when true (default) HTTP-pings `/api/system/status` to
 * confirm the container is actually serving Sonar. Tests can disable
 * the probe for hermetic mocking.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.probe=true]
 * @param {number} [opts.healthcheckSeconds=5]
 * @returns {Promise<DiscoveredSonar>}
 */
export async function discoverRunningSonar(opts = {}) {
  const { probe = true, healthcheckSeconds = 5 } = opts;
  let candidate;
  try {
    candidate = await dockerPsForSonar();
  } catch {
    candidate = null;
  }
  if (!candidate) return { found: false };
  if (!probe) return { ...candidate, reachable: true };
  let reachable;
  try {
    reachable = await isSonarReachable(candidate.host, healthcheckSeconds);
  } catch {
    reachable = false;
  }
  return { ...candidate, reachable };
}
