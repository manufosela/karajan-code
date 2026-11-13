/**
 * Node.js runtime version check. Requires Node >= 22 — the Active LTS
 * baseline since Karajan v3.0.0 (KJC-TSK-0500, 2026-06-03). Node 20 was
 * dropped because (a) Node 20 reaches EOL on 2026-04-30 and (b) three
 * dependencies forced the bump: commander 15 needs ≥22.12.0 and
 * better-sqlite3 v12.10+ dropped Node 20 prebuilds. engines.node is
 * ">=22.12.0" — the highest RUNTIME floor. KJC-BUG-0111: it briefly sat
 * at 22.22.1 (lint-staged 17's floor — a devDependency end users never
 * run) and npm silently served karajan-code@2.34.0 to every Node
 * 22.0-22.21 install; keep dev-tool floors out of engines.
 * Strategy: manual — we cannot auto-upgrade the runtime. Users on older
 * Node get a clear upgrade instruction with nvm + brew hints instead of a
 * silent runtime crash.
 * KJC-TSK-1602 (2026-11-13): Node 22 still works but Node 24 is recommended
 * (22 support ends April 2027; kj 6.0 will require 24). A version in between
 * is ok with severity "warn": doctor shows it and the exit code stays 0.
 */

import { STRATEGY } from "./types.js";

export const MIN_NODE_MAJOR = 22;
export const RECOMMENDED_NODE_MAJOR = 24;
export const NODE_UPGRADE_GUIDE = "https://karajancode.com/docs/guides/node-24/";

/**
 * Accepts a version string in the form "v20.12.1" or "20.12.1" and returns
 * an object { major, minor, patch } or null when the shape is invalid.
 */
export function parseNodeVersion(versionString) {
  const str = String(versionString || "").trim();
  const m = str.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Create the Node version check. Accepts an optional override of the
 * reported version (useful in tests).
 *
 * @param {{ version?: string }} [opts]
 * @returns {import("./types.js").Check}
 */
export function createNodeVersionCheck(opts = {}) {
  return {
    name: "node-version",
    label: "Node.js runtime",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const raw = opts.version ?? process.env.KJ_FORCE_NODE_VERSION ?? process.version;
      const parsed = parseNodeVersion(raw);
      if (!parsed) {
        return {
          ok: false,
          severity: "fail",
          detail: `Unrecognized Node version: ${raw}`,
          fix: `Install Node ${MIN_NODE_MAJOR}+ from https://nodejs.org/ (current: ${raw}).`,
        };
      }
      if (parsed.major < MIN_NODE_MAJOR) {
        return {
          ok: false,
          severity: "fail",
          detail: `Node ${raw} detected, requires >=${MIN_NODE_MAJOR}`,
          fix: `Upgrade Node to ${MIN_NODE_MAJOR}+ (nvm install ${RECOMMENDED_NODE_MAJOR} && nvm use ${RECOMMENDED_NODE_MAJOR}, or brew upgrade node). Guide: ${NODE_UPGRADE_GUIDE}`,
          extra: { detected: parsed, required: MIN_NODE_MAJOR },
        };
      }
      if (parsed.major < RECOMMENDED_NODE_MAJOR) {
        return {
          ok: true,
          severity: "warn",
          advisory: true,
          detail: `${raw} works; Node ${RECOMMENDED_NODE_MAJOR} is recommended: Node 22 support ends in April 2027 and kj 6.0 will require ${RECOMMENDED_NODE_MAJOR}`,
          fix: `Upgrade to Node ${RECOMMENDED_NODE_MAJOR}: ${NODE_UPGRADE_GUIDE}`,
        };
      }
      return { ok: true, severity: "info", detail: `${raw} (>= ${MIN_NODE_MAJOR} required)` };
    },
  };
}

export function getNodeChecks() {
  return [createNodeVersionCheck()];
}
