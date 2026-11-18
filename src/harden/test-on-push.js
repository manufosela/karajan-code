/**
 * Test-on-push policy (KJC-TSK-0647) — the full suite on every push is
 * redundant when CI already runs it per PR, and a source of false reds
 * (suites unstable under local parallelism). Field-reproduced.
 *
 * Policy: a CI workflow that runs tests ⇒ pre-push drops its test command
 * (identity guard and chaining stay). Repos can force it back with
 * `"kj": { "harden": { "test_on_push": true } }` in package.json. Repos
 * without CI keep tests on push — there it IS the last safety net.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_STEP = /\b(npm (run )?test|vitest|jest|pytest|go test|phpunit|cargo test)\b/;

/** Whether a workflow's text runs the tests. */
export const runsTests = (body) => typeof body === "string" && TEST_STEP.test(body);

export function ciRunsTests(projectDir) {
  const dir = join(projectDir, ".github", "workflows");
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .some((f) => TEST_STEP.test(readFileSync(join(dir, f), "utf8")));
  } catch {
    return false;
  }
}

/** HU-4621 (ADR 0065): the repo's own workflow (not a kj-* one) that runs the tests, or null. */
export function ownTestWorkflow(projectDir) {
  const dir = join(projectDir, ".github", "workflows");
  if (!existsSync(dir)) return null;
  const own = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !f.startsWith("kj-"))
    .toSorted();
  return own.find((f) => TEST_STEP.test(readFileSync(join(dir, f), "utf8"))) ?? null;
}

// KJC-BUG-0611: `installsCiTests`, the CI the same kj harden run installs runs the tests.
export function resolveTestOnPush({ projectDir, repoCfg = {}, testCmd = null, installsCiTests = false }) {
  if (!testCmd) return { testCmd: null, reason: null };
  if (repoCfg.test_on_push === true) return { testCmd, reason: null };
  if (installsCiTests || ciRunsTests(projectDir)) {
    return {
      testCmd: null,
      reason: "CI already runs the suite per PR — pre-push keeps only the identity guard (opt back in with kj.harden.test_on_push: true in package.json)",
    };
  }
  return { testCmd, reason: null };
}
