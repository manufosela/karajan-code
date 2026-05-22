import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Resilience audit, Phase 3: a corrupt plan JSON (truncated by an
// interrupted write, hand-edit gone wrong) used to be silently skipped
// — `kj plan list` lost the plan with no error or warning, and a
// `loadPlan(planId)` of a corrupt file returned null as if the plan
// did not exist. Now we WARN and rename the file aside.

let kjHome;
let projectDir;
let plansSubDir;

beforeEach(() => {
  kjHome = mkdtempSync(join(tmpdir(), "kj-plan-corrupt-"));
  process.env.KJ_HOME = kjHome;
  projectDir = "/proj"; // → projectSlug = "proj"
  plansSubDir = join(kjHome, "plans", "proj");
  mkdirSync(plansSubDir, { recursive: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.KJ_HOME;
  rmSync(kjHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const { listPlans, loadPlan } = await import("../../src/plan/plan-store.js");

describe("plan-store — corrupt JSON handling", () => {
  it("listPlans warns about a corrupt file (was silently skipped)", async () => {
    writeFileSync(join(plansSubDir, "plan-bad.json"), "{not valid json");

    const plans = await listPlans(projectDir);

    expect(plans).toEqual([]);
    expect(
      console.warn.mock.calls.some(([msg]) => /Corrupt plan JSON/.test(String(msg)))
    ).toBe(true);
  });

  it("renames the corrupt file aside so subsequent reads do not trip on it", async () => {
    writeFileSync(join(plansSubDir, "plan-bad.json"), "{not valid json");

    await listPlans(projectDir);

    const files = readdirSync(plansSubDir);
    expect(files.some((f) => f.includes(".corrupt-"))).toBe(true);
    expect(files).not.toContain("plan-bad.json");
  });

  it("listPlans skips renamed-aside .corrupt-* files in its own output", async () => {
    writeFileSync(
      join(plansSubDir, "plan-bad.json.corrupt-1700000000000"),
      "{not valid"
    );
    writeFileSync(
      join(plansSubDir, "plan-ok.json"),
      JSON.stringify({ planId: "plan-ok", version: 2, hus: [], task: "t" })
    );

    const plans = await listPlans(projectDir);

    expect(plans.map((p) => p.planId)).toEqual(["plan-ok"]);
    // The corrupt aside file is NOT re-processed as a new corrupt.
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("loadPlan returns null AND warns when the targeted plan is corrupt", async () => {
    writeFileSync(join(plansSubDir, "plan-x.json"), "broken");

    const result = await loadPlan(projectDir, "plan-x");

    expect(result).toBeNull();
    expect(
      console.warn.mock.calls.some(([msg]) => /Corrupt plan JSON/.test(String(msg)))
    ).toBe(true);
  });

  it("loadPlan stays silent on ENOENT — caller may legitimately probe an unknown id", async () => {
    const result = await loadPlan(projectDir, "plan-nonexistent");
    expect(result).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
