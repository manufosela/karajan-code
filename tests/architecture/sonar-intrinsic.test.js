/**
 * Architecture regression guard — Sonar is INTRINSIC to Karajan, not a
 * config toggle.
 *
 * The user's contract (set in v2.7.4): SonarQube quality gate is run for
 * every code task (sw / refactor / add-tests) and skipped for non-code tasks
 * (audit / doc / infra / analysis / no-code). The decision lives in
 * `src/guards/policy-resolver.js::DEFAULT_POLICIES`. Users CANNOT disable
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
 * the way", STOP. Read `src/orchestrator/preflight-checks.js`,
 * `src/orchestrator/flow-runner.js::runQualityGateStages`, and
 * `src/guards/policy-resolver.js`. Then open a discussion before changing
 * the contract.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn().mockResolvedValue({ ok: true, version: "test" }),
}));

describe("architecture/sonar-intrinsic — Sonar is not a config toggle", () => {
  describe("preflight (runPreflightChecks)", () => {
    it("does NOT read config.sonarqube.enabled — only resolvedPolicies.sonar", async () => {
      // Read the source and assert the guard is the policy, not the config.
      // A textual assertion is uglier than mocking, but it's the only way to
      // prevent a future PR from sneaking the config check back in by
      // ANDing with `sonarqube.enabled` again.
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const url = await import("node:url");
      const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
      const text = await fs.readFile(
        path.join(repoRoot, "src/orchestrator/preflight-checks.js"),
        "utf8",
      );
      // Forbid the AND with config.sonarqube.enabled — that was the v2.7.3 bug.
      expect(
        text.match(/sonarqube\?\.enabled\)\s*&&\s*resolvedPolicies/i),
        "Preflight must derive sonarEnabled from resolvedPolicies.sonar ONLY, not from config.sonarqube.enabled. " +
          "Sonar is intrinsic to Karajan for code tasks since v2.7.4.",
      ).toBeNull();
      // Affirmative: the live expression must reference resolvedPolicies (the
      // gate may include a test-only escape hatch like __KJ_DISABLE_SONAR_STAGE
      // ANDed in, which is fine — what matters is that production code only
      // looks at resolvedPolicies and never at config.sonarqube.enabled).
      expect(text).toMatch(/resolvedPolicies\.sonar\s*!==\s*false/);
    });
  });

  describe("iteration-loop driver (runQualityGateStages)", () => {
    it("gates the sonar stage on resolved_policies.sonar, not config.sonarqube.enabled", async () => {
      // TSK-0335 (Oleada 3): runQualityGateStages moved from flow-runner.js
      // into the iteration-loop driver. v2.7.x audit follow-up: extracted
      // again into ./iteration-phases/quality-gates.js to stay under the
      // 600-LOC ceiling. Assert the invariant at the new address so the
      // decomposition can't sneak the forbidden gate back in.
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const url = await import("node:url");
      const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
      const text = await fs.readFile(
        path.join(repoRoot, "src/orchestrator/drivers/iteration-phases/quality-gates.js"),
        "utf8",
      );
      // Forbid: `if (config.sonarqube.enabled && ...) runSonarStage`
      expect(
        text.match(/config\.sonarqube\.enabled\s*&&[^\n]*runSonarStage/i),
        "runSonarStage must be gated on session.resolved_policies.sonar, not config.sonarqube.enabled.",
      ).toBeNull();
      // Affirmative: must check resolved_policies in the gate.
      expect(text).toMatch(/session\.resolved_policies\?\.sonar\s*!==\s*false[^\n]*\)\s*\{[\s\S]{0,600}runSonarStage/);
    });
  });

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

  describe("policy mapping (DEFAULT_POLICIES)", () => {
    it("code task types DO require Sonar", async () => {
      const { applyPolicies } = await import("../../src/guards/policy-resolver.js");
      for (const codeType of ["sw", "refactor", "add-tests"]) {
        const res = applyPolicies({ taskType: codeType, policies: {} });
        expect(res.sonar, `taskType=${codeType} must require Sonar`).toBe(true);
      }
    });

    it("non-code task types do NOT require Sonar", async () => {
      const { applyPolicies } = await import("../../src/guards/policy-resolver.js");
      for (const nonCodeType of ["audit", "doc", "infra", "analysis", "no-code"]) {
        const res = applyPolicies({ taskType: nonCodeType, policies: {} });
        expect(res.sonar, `taskType=${nonCodeType} must NOT require Sonar`).toBe(false);
      }
    });
  });
});
