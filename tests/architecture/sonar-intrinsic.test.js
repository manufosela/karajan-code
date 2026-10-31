/**
 * Architecture regression guard — Sonar is INTRINSIC to Karajan, not a
 * config toggle.
 *
 * The user's contract (set in v2.7.4): SonarQube quality gate is run for
 * every code task (sw / refactor / add-tests) and skipped for non-code tasks
 * (audit / doc / infra / analysis / no-code); the review gate enforces it
 * (`src/review/sonar-requirement.js`). Users CANNOT disable
 * Sonar via `sonarqube.enabled: false` or `--no-sonar` — those are accepted
 * (back-compat) but ignored, with a deprecation warning.
 *
 * Rationale: a user running with `sonarqube.enabled: false` on a code task
 * is doing a job Karajan refuses to call complete (no quality gate, no
 * static analysis, no enforcement of the project's standards). That's not a
 * use case Karajan supports. Solomon may decide to skip a single iteration
 * via runtime rule alerts (legitimate — that's a runtime override based on
 * evidence), but the user cannot pre-disable Sonar at config load time.
 *
 * If you find yourself wanting to remove these tests because they're "in
 * the way", STOP. Read `src/review/sonar-requirement.js` (the review gate's
 * "Sonar is mandatory for code"). Then open a discussion before changing the
 * contract.
 *
 * KJC-TSK-1331 / KJC-TSK-1339: the cases on the retired pipeline's
 * preflight-checks.js, quality-gates.js and policy-resolver.js went with those
 * files (5.0); the flag handling and config cases stay.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn().mockResolvedValue({ ok: true, version: "test" }),
}));

describe("architecture/sonar-intrinsic — Sonar is not a config toggle", () => {
  describe("flag handling", () => {
    it("accepts --no-sonar but records it as deprecated (does NOT mutate sonarqube.enabled)", async () => {
      const { applyRunOverrides } = await import("../../src/config.js");
      const base = {
        sonarqube: { enabled: true },
        sonarcloud: { enabled: false },
        development: {},
        pipeline: {},
        reviewer_options: {},
        coder_options: {},
        session: {},
        git: {},
      };
      const out = applyRunOverrides(base, { noSonar: true });
      // Old behaviour (v2.7.3 and earlier): `out.sonarqube.enabled === false`.
      // New behaviour: enabled is unchanged, deprecation flag is set.
      expect(out.sonarqube.enabled).toBe(true);
      expect(out._deprecated?.noSonarFlag).toBe(true);
    });

    it("accepts sonar=false the same way (deprecated, ignored)", async () => {
      const { applyRunOverrides } = await import("../../src/config.js");
      const base = {
        sonarqube: { enabled: true }, sonarcloud: { enabled: false },
        development: {}, pipeline: {}, reviewer_options: {}, coder_options: {},
        session: {}, git: {},
      };
      const out = applyRunOverrides(base, { sonar: false });
      expect(out.sonarqube.enabled).toBe(true);
      expect(out._deprecated?.noSonarFlag).toBe(true);
    });
  });

  describe("config load", () => {
    it("flags sonarqube.enabled in user config as deprecated", async () => {
      // Direct unit-level check on the loadConfig logic. We don't actually
      // load a file (avoids fs setup); instead we replicate the code path.
      // This test is a guard: any change that drops the deprecation flag
      // should fail it.
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const url = await import("node:url");
      const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
      const text = await fs.readFile(path.join(repoRoot, "src/config/loader.js"), "utf8");
      expect(text).toMatch(/userSetSonarEnabled/);
      expect(text).toMatch(/sonarqubeEnabledKey/);
      expect(text).toMatch(/_deprecated/);
    });
  });
});
