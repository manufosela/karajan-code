// KJC-TSK-0676 part 2 — the review gate runs the sonar pre-gate BEFORE the
// cross-AI verdict: blocking findings reject without spending reviewer
// tokens; advisory ones travel inside the reviewer's task.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const pregateMock = vi.fn();
const reviewMock = vi.fn();

vi.mock("../../src/review/sonar-pregate.js", async (orig) => ({
  ...(await orig()), runSonarPregate: (...a) => pregateMock(...a),
}));
vi.mock("../../src/review/one-shot-review.js", () => ({ runOneShotReview: (...a) => reviewMock(...a) }));

import { reviewGateCommand } from "../../src/commands/review-gate.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gate-sonar-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  git("add", "a.js"); git("commit", "-qm", "base");
  fs.writeFileSync(path.join(dir, "a.js"), "y\n");
  git("add", "a.js");
  process.chdir(dir); // rawDiff runs git in the process cwd
  reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789", summary: "" });
});

const cfg = () => ({ projectDir: dir });
const finding = (severity) => ({ component: `k:a.js`, severity, rule: "js:S1", line: 1, message: "boom" });

describe("review gate × sonar pre-gate", () => {
  it("blocking findings reject WITHOUT invoking the cross-AI reviewer", async () => {
    pregateMock.mockResolvedValue({ available: true, blocking: [finding("CRITICAL")], advisory: [], totalProject: 1 });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true } });
    expect(r.verdict).toBe("rejected");
    expect(r.reviewer).toBe("sonar");
    expect(reviewMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("advisory findings travel inside the reviewer task and pass staged files to the pre-gate", async () => {
    pregateMock.mockResolvedValue({ available: true, blocking: [], advisory: [finding("MINOR")], totalProject: 1, covered: ["a.js"], uncovered: [] });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true, task: "my intent" } });
    expect(r.verdict).toBe("approved");
    expect(pregateMock.mock.calls[0][0].stagedFiles).toEqual(["a.js"]);
    expect(reviewMock.mock.calls[0][0].task).toContain("my intent");
    expect(reviewMock.mock.calls[0][0].task).toContain("boom");
  });

  // KJC-TSK-0838: fail-CLOSED for code. Unavailable or disabled sonar used to
  // warn and continue — that is how 4 code PRs reached main unanalysed.
  it("unavailable sonar REJECTS a diff with code before any reviewer token is spent", async () => {
    pregateMock.mockResolvedValue({ available: false, reason: "server down" });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true } });
    expect(r.verdict).toBe("rejected");
    expect(r.reviewer).toBe("sonar");
    expect(r.issues[0].description).toMatch(/Sonar is mandatory for code/);
    expect(reviewMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("a staged source the scan never indexed rejects too", async () => {
    pregateMock.mockResolvedValue({ available: true, projectKey: "k", blocking: [], advisory: [], totalProject: 0, covered: [], uncovered: ["a.js"] });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true } });
    expect(r.verdict).toBe("rejected");
    expect(r.issues[0].description).toContain("a.js");
    expect(reviewMock).not.toHaveBeenCalled();
  });

  // KJC-TSK-0838: what Sonar saw travels INSIDE the verdict, bound to the
  // diff hash like the reviewer's opinion — so --check and the method report
  // can tell a reviewed diff from a reviewed AND analysed one.
  it("hands the reviewer a sonar block with proved coverage for the verdict record", async () => {
    pregateMock.mockResolvedValue({
      available: true, projectKey: "k", blocking: [], advisory: [], totalProject: 0, covered: ["a.js"], uncovered: [],
    });
    await reviewGateCommand({ config: cfg(), flags: { staged: true } });
    expect(reviewMock.mock.calls[0][0].sonar).toEqual({
      ran: true, projectKey: "k", covered: ["a.js"], uncovered: [], blocking: 0, advisory: 0, mode: "pass",
    });
  });

  it("records that sonar did NOT run, with the reason, when the diff has no code", async () => {
    fs.writeFileSync(path.join(dir, "README.md"), "docs\n");
    execFileSync("git", ["-C", dir, "reset", "-q", "a.js"]);
    execFileSync("git", ["-C", dir, "add", "README.md"]);
    pregateMock.mockResolvedValue({ available: false, reason: "server down" });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true } });
    expect(r.verdict).toBe("approved"); // docs-only: exempt
    expect(reviewMock.mock.calls[0][0].sonar).toEqual({ ran: false, reason: "server down", mode: "docs-only" });
  });

  it("--no-sonar is not an escape for code: the diff is rejected without a scan", async () => {
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true, sonar: false } });
    expect(pregateMock).not.toHaveBeenCalled();
    expect(r.verdict).toBe("rejected");
    expect(r.reviewer).toBe("sonar");
  });
});
