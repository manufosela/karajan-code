/**
 * Opt-in feature test guard (KJC-TSK-0307).
 *
 * Many test files exercise opt-in subsystems (Brain, CI, SonarQube, HU Board,
 * Impeccable, WebPerf, Telemetry). They run every time because the tests
 * themselves don't check whether the feature is enabled in the current
 * environment — they just stub it.
 *
 * This module provides a small helper + a registry of known feature gates so
 * describe() blocks can self-describe their dependency and optionally skip
 * themselves at runtime when the feature is off.
 *
 * Usage:
 *
 *   import { describe, it, expect } from "vitest";
 *   import { optIn } from "../support/opt-in.js";
 *
 *   optIn("brain").describe("brain-coordinator", () => {
 *     it("...", () => { ... });
 *   });
 *
 * Behaviour:
 * - If the feature is considered "on" (env var set OR feature always-on in
 *   tests), the describe runs normally.
 * - If explicitly disabled via `KJ_SKIP_OPTIN_<FEATURE>=1`, the block is
 *   skipped via describe.skip.
 * - The feature name is appended to the describe label so reports and
 *   `vitest --filter` work on it.
 *
 * Default stance: opt-in tests RUN in CI (they mock the feature). The skip
 * knob is for local fast-loops when a developer wants to ignore a subsystem.
 */

import { describe } from "vitest";

export const OPT_IN_FEATURES = /** @type {const} */ ([
  "brain",
  "ci",
  "sonar",
  "hu-board",
  "impeccable",
  "webperf",
  "telemetry",
  "rtk",
  "solomon",
]);

/**
 * Returns true when the given feature has been explicitly disabled via env.
 * Checks both the specific per-feature env var and a global kill switch.
 * @param {string} feature
 */
export function isOptInSkipped(feature) {
  const key = feature.toUpperCase().replace(/-/g, "_");
  return (
    process.env[`KJ_SKIP_OPTIN_${key}`] === "1" ||
    process.env.KJ_SKIP_ALL_OPTIN === "1"
  );
}

/**
 * Wrap a describe block so it is tagged with [opt-in: feature] and skipped
 * when the feature is explicitly disabled.
 *
 * @param {(typeof OPT_IN_FEATURES)[number]} feature
 */
export function optIn(feature) {
  if (!OPT_IN_FEATURES.includes(feature)) {
    throw new Error(`Unknown opt-in feature: ${feature}. Add it to OPT_IN_FEATURES in tests/support/opt-in.js`);
  }
  const prefix = `[opt-in: ${feature}]`;
  const run = isOptInSkipped(feature) ? describe.skip : describe;
  return {
    /**
     * @param {string} label
     * @param {() => void} body
     */
    describe(label, body) {
      return run(`${prefix} ${label}`, body);
    },
  };
}
