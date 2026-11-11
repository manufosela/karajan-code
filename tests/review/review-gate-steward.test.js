// KJC-TSK-1086: with method_gates.steward: block, a sweep with vulnerable-deps
// or main-ci broken rejects the commit before any reviewer token, as it stops
// starting to edit in the Sentinel.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const reviewMock = vi.fn();
vi.mock("../../src/review/one-shot-review.js", () => ({ runOneShotReview: (...a) => reviewMock(...a) }));

import { reviewGateCommand } from "../../src/commands/review-gate.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gate-steward-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git("add", "-A"); git("commit", "-qm", "base");
  fs.writeFileSync(path.join(dir, "README.md"), "y\n");
  git("add", "README.md");
  fs.mkdirSync(path.join(dir, ".karajan", "steward"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "steward", "report.json"), JSON.stringify({
    sweptAt: "2026-10-18T00:00:00Z", invariants: [{ id: "main-ci", verdict: "broken", evidence: "red", remedy: "fix main" }],
  }));
  process.chdir(dir);
  reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789", summary: "" });
});

describe("review gate × steward", () => {
  it("blocks before the reviewer when the project adopted block", async () => {
    const r = await reviewGateCommand({ config: { projectDir: dir, method_gates: { steward: "block" } }, flags: { staged: true, sonar: false } });
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "steward" });
    expect(r.issues[0].description).toMatch(/main-ci: red -> fix main/);
    expect(reviewMock).not.toHaveBeenCalled();
  });

  it("does not block in inform mode", async () => {
    const r = await reviewGateCommand({ config: { projectDir: dir, method_gates: { steward: "inform" } }, flags: { staged: true, sonar: false } });
    expect(r.reviewer).not.toBe("steward");
  });

  // KJC-TSK-1523: each check leaves its line for kj stage: the Steward's, then the tests with the code.
  it("leaves the Steward's check and the tests-with-code one in the lane's method trace", async () => {
    const trace = () => fs.readFileSync(path.join(dir, ".karajan", "traces", "method.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    await reviewGateCommand({ config: { projectDir: dir, method_gates: { steward: "block" } }, flags: { staged: true, sonar: false } });
    expect(trace().map((l) => [l.piece, l.outcome])).toEqual([["steward", "refuse"]]);
    await reviewGateCommand({ config: { projectDir: dir, method_gates: { steward: "inform" } }, flags: { staged: true, sonar: false } });
    expect(trace().map((l) => [l.piece, l.outcome]).slice(1)).toEqual([["steward", "pass"], ["tdd", "pass"]]);
  });
});
