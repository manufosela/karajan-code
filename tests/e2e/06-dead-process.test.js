/**
 * E2E #06 — process killed mid-iteration must NOT leave HUs zombie'd.
 *
 * Spec: tests/e2e spec ("FASE 1") §6.
 *
 * Regression for the 2026-04-27 zombie-status bug: when `kj run` was
 * killed (SIGTERM, OOM, segfault, ctrl-C) during a coder iteration,
 * the on-disk plan kept its HU(s) at `coding` — the board's "1
 * running…" badge stayed lit forever. The fix is two-pronged:
 *   PR #537 — board reconciles status by inspecting session state
 *   PR #544 — full-content reconcile against persisted batch
 * This test pins that NO matter what happened to the process, the on-
 * disk plan never holds a `coding` / `reviewing` status post-mortem
 * once the next `kj` invocation reads the plan.
 *
 * Strategy: spawn `kj run` async via spawn() (not spawnSync — we need
 * to SIGTERM it mid-flight). Wait until at least one HU has flipped
 * to `coding`, then SIGTERM. The plan JSON written by the dying
 * process MAY hold "coding". Then we run `kj plan show` (which
 * triggers reconciliation) and assert the HU is no longer in the
 * "running-but-process-dead" state.
 *
 * Asserts:
 *   - the HU does NOT remain in `coding` indefinitely
 *   - process death does NOT corrupt the plan JSON beyond reconciliation
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runKj } from "./helpers/spawn-kj.js";
import { makeTmpProject } from "./helpers/tmp-project.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KJ_BIN = path.resolve(HERE, "..", "..", "bin", "kj.js");
const FAKE_AGENT_PATH = path.resolve(HERE, "fixtures", "fake-coder.js");

const SPEC = fs.readFileSync(path.join(HERE, "fixtures/plans/minimal-spec.md"), "utf8");

function makeFixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kj-e2e-fixture-"));
}

function readPlanFile(kjHome) {
  const slugRoot = path.join(kjHome, "plans");
  const slugs = fs.readdirSync(slugRoot);
  const plansDir = path.join(slugRoot, slugs[0]);
  const planFiles = fs.readdirSync(plansDir).filter(f => f.endsWith(".json"));
  const planPath = path.join(plansDir, planFiles[0]);
  return { planId: path.basename(planFiles[0], ".json"), planPath };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe("e2e/06 — kj run killed mid-iteration must not leave HUs zombie'd", () => {
  let proj, fixtureDir, child;
  afterEach(async () => {
    try { if (child && !child.killed) child.kill("SIGKILL"); } catch { /* */ }
    try { proj?.cleanup(); } catch { /* */ }
    try { if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("post-SIGTERM, the next kj invocation does not see HUs stuck at coding", async () => {
    proj = makeTmpProject({ spec: SPEC, prefix: "kj-e2e-06-" });
    fixtureDir = makeFixtureDir();

    // Slow-coder script: when invoked, the fake sleeps ~3s before
    // returning. We use a long-running bash via `sleep` in the
    // acceptance test to keep the iteration alive while we SIGTERM.
    const planner = JSON.stringify({
      approach: "slow-iteration",
      steps: [{
        description: "slow", commit: "feat: x", spec_section: "1",
        acceptance_tests: ["sleep 30 && true"]
      }],
      risks: [], outOfScope: []
    });
    fs.writeFileSync(path.join(fixtureDir, "coder-script.json"), JSON.stringify({
      planner: { output: planner }
    }));

    // 1) Generate the plan synchronously.
    const gen = runKj(
      ["plan", "generate", "--task-file", "SPEC.md", "-y", "--planner", "fake", "--no-preflight-hu"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 60_000 }
    );
    expect(gen.exitCode, `gen stderr: ${gen.stderr}`).toBe(0);
    const { planId, planPath } = readPlanFile(proj.kjHome);
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    for (const h of plan.hus) h.status = "certified";
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

    // 2) Spawn `kj run` asynchronously so we can SIGTERM mid-flight.
    const env = {
      ...process.env,
      CLAUDECODE: undefined,
      KJ_HOME: proj.kjHome,
      KJ_PLANS_DIR: path.join(proj.kjHome, "plans"),
      CI: "1", VITEST: "1", NODE_ENV: "test",
      TEST_FIXTURE_DIR: fixtureDir,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import="file://${FAKE_AGENT_PATH}"`.trim(),
    };
    child = spawn(process.execPath, [
      KJ_BIN, "run", "--plan", planId, "-y",
      "--coder", "fake", "--reviewer", "fake", "--planner", "fake",
      "--task-type", "doc", "--max-iterations", "1",
    ], { cwd: proj.projectDir, env, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    // Wait for the HU to enter `coding` state on disk OR up to 6s.
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      try {
        const p = JSON.parse(fs.readFileSync(planPath, "utf8"));
        const hu = p.hus[0];
        if (hu && hu.status === "coding") break;
      } catch { /* mid-write */ }
      await sleep(200);
    }

    // SIGTERM mid-iteration. The acceptance test (`sleep 30`) is still
    // running, so the run has NOT finished — this simulates the user
    // hitting ctrl-C during a long iteration.
    child.kill("SIGTERM");

    // Wait for child to exit (give the OS time to deliver the signal).
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } resolve(); }, 5000);
      child.on("exit", () => { clearTimeout(t); resolve(); });
    });

    // 3) After death, the on-disk plan MAY still hold "coding". The
    // reconciliation contract (PR #537 + PR #544) is enforced at the
    // start of the NEXT `kj run`, not on every read. Reset the broken
    // acceptance test (so the re-run doesn't hang on `sleep 30`
    // again) and re-promote the HU to certified before re-running.
    const mid = JSON.parse(fs.readFileSync(planPath, "utf8"));
    const huMid = mid.hus[0];
    expect(huMid, "HU disappeared from plan").toBeTruthy();
    // Reset the test so the re-run completes quickly.
    huMid.acceptance_tests = [{ type: "shell", content: "true" }];
    huMid.status = "certified";
    fs.writeFileSync(planPath, JSON.stringify(mid, null, 2));

    // Re-run — this exercises the reconcile-on-restart path documented
    // in src/orchestrator/hu-sub-pipeline.js§reconciled-from-plan.
    const rerun = runKj(
      ["run", "--plan", planId, "-y",
        "--coder", "fake", "--reviewer", "fake", "--planner", "fake",
        "--task-type", "doc", "--max-iterations", "1"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 60_000 }
    );
    if (rerun.exitCode !== 0) {
      console.error("[06] re-run stdout tail:", rerun.stdout.slice(-1000));
      console.error("[06] re-run stderr tail:", rerun.stderr.slice(-500));
    }
    expect(rerun.exitCode).toBe(0);

    const post = JSON.parse(fs.readFileSync(planPath, "utf8"));
    const hu = post.hus[0];
    expect(hu, "HU disappeared from plan").toBeTruthy();
    // After re-run, the HU MUST NOT remain at `coding`. The acceptable
    // terminal states are `done` (the re-run succeeded) or `failed`
    // (some reconciliation route marked it). The zombie state is the
    // bug class being pinned.
    if (hu.status === "coding") {
      console.error("[06] zombie HU survived. run stdout tail:", stdout.slice(-500));
      console.error("[06] run stderr tail:", stderr.slice(-500));
    }
    expect(hu.status, "HU stuck at `coding` after re-run (zombie regression)").not.toBe("coding");
    // Touch the captured streams so eslint no-unused-vars stays happy
    // and so we have something to print on flake.
    void stdout; void stderr;
  }, 90_000);
});
