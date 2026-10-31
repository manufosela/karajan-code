// KJC-BUG-0423 (issue #2655): a commit went through although the last review of
// that exact staged diff was REJECTED. The real kj, a real repo: approve, then
// reject the same diff, and the commit check must refuse it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeScenarioProject } from "./helpers/scenario-project.js";

const verdict = (approved) => ({
  output: JSON.stringify({ approved, blocking_issues: approved ? [] : [{ severity: "high", description: "scenario blocker" }], non_blocking_suggestions: [], summary: approved ? "ok" : "no" }),
});

let p;
let fixtureDir;

beforeAll(() => {
  p = makeScenarioProject();
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-scn-rejected-"));
  fs.writeFileSync(path.join(p.dir, "NOTES.md"), "# Notes\n\nA staged change.\n");
  p.git("add", "NOTES.md");
}, 60_000);
afterAll(() => {
  p?.cleanup();
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe("scenario: the last verdict of a staged diff decides the commit", () => {
  // The fake reviewer counts its calls per process: each review gets its own script.
  const reviewAnswering = (approved) => {
    fs.writeFileSync(path.join(fixtureDir, "coder-script.json"), JSON.stringify({ reviewer: verdict(approved) }));
    return p.kjFake(fixtureDir, "review", "--staged", "--reviewer", "fake", "docs: add notes");
  };

  it("an approval followed by a rejection of the same diff refuses the commit", () => {
    const first = reviewAnswering(true);
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const second = reviewAnswering(false);
    expect(second.status, second.stdout + second.stderr).toBe(1);
    const check = p.kj("review", "--check");
    expect(check.status, check.stdout + check.stderr).not.toBe(0);
    expect(check.stdout).toMatch(/rejected/i);
  }, 300_000);
});
