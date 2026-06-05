// Shared helper for tests that legitimately exercise the Sonar stage
// (tests/setup.js sets globalThis.__KJ_DISABLE_SONAR_STAGE = true so
// most non-Sonar tests skip Docker). Five files declared the same
// save-restore-set dance inline (audit by KJC-TSK-0502).
//
// Usage:
//   import { describe, beforeEach, afterAll } from "vitest";
//   import { enableSonarStageForSuite } from "../_fixtures/sonar-stage.js";
//
//   describe("…", () => {
//     enableSonarStageForSuite();
//     // your tests
//   });
//
// The helper registers a beforeEach that flips the flag off and an
// afterAll that restores the previous value, so the next describe
// block is unaffected.

import { beforeEach, afterAll } from "vitest";

export function enableSonarStageForSuite() {
  const prev = globalThis.__KJ_DISABLE_SONAR_STAGE;
  beforeEach(() => {
    globalThis.__KJ_DISABLE_SONAR_STAGE = false;
  });
  afterAll(() => {
    globalThis.__KJ_DISABLE_SONAR_STAGE = prev;
  });
}
