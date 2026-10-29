// KJC-TSK-0691 (MG-E) — field case: a 522-line PR sailed past the warning
// with a rationalization. Where the project wants teeth, pr_size becomes a
// block with a NAMED escape; the default stays warn.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const reviewMock = vi.fn();
vi.mock("../../src/review/one-shot-review.js", () => ({ runOneShotReview: (...a) => reviewMock(...a) }));
vi.mock("../../src/review/sonar-pregate.js", async (orig) => ({
  // KJC-TSK-0838: sonar is fail-closed for code — this suite is not about it, so it proves coverage.
  ...(await orig()), runSonarPregate: vi.fn(async ({ stagedFiles }) => ({ available: true, projectKey: "t", blocking: [], advisory: [], covered: stagedFiles, uncovered: [] })),
}));
vi.mock("../../src/review/card-first.js", async (orig) => ({
  ...(await orig()), checkCardFirst: vi.fn().mockResolvedValue({ ok: true, mode: "pass" }),
}));

import { reviewGateCommand } from "../../src/commands/review-gate.js";
import { seedRagLedger } from "./_seed-rag-ledger.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); delete process.env.KJ_ALLOW_LARGE_PR; });
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-prsize-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "base\n");
  git("add", "a.js"); git("commit", "-qm", "base");
  fs.writeFileSync(path.join(dir, "a.js"), Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n"));
  fs.writeFileSync(path.join(dir, "tests.test.js"), "test\n");
  git("add", "-A");
  // KJC-BUG-0192: staging code now requires a harness that recorded the session.
  seedRagLedger(dir, ["a.js", "tests.test.js"]);
  process.chdir(dir);
  reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789" });
});

const cfg = (pr_size) => ({ projectDir: dir, method_gates: { pr_size, pr_size_warn: 150 } });

describe("pr-size policy", () => {
  it("block rejects an oversized diff WITHOUT invoking the reviewer, naming the user's label", async () => {
    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const r = await reviewGateCommand({ config: cfg("block"), flags: { staged: true } });
    spy.mockRestore();
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "pr-size" });
    expect(reviewMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(logs.join("\n")).toMatch(/large-pr-justified/);
    expect(logs.join("\n")).not.toMatch(/KJ_ALLOW/);
  });

  it("KJ_ALLOW_LARGE_PR=1 no longer opens the gate (ADR 0015)", async () => {
    process.env.KJ_ALLOW_LARGE_PR = "1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await reviewGateCommand({ config: cfg("block"), flags: { staged: true } });
    spy.mockRestore();
    expect(r.verdict).toBe("rejected");
  });

  // KJC-BUG-0326 (#2085): ~150 is the ideal and up to 200 is allowed without asking;
  // above 200, partition, always. The agent asked for an OK inside the allowed band.
  it("between the ideal and the limit it only informs, even with block, and asks nothing", async () => {
    fs.writeFileSync(path.join(dir, "a.js"), Array.from({ length: 170 }, (_, i) => `line ${i}`).join("\n"));
    execFileSync("git", ["-C", dir, "add", "a.js"]);
    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const r = await reviewGateCommand({ config: cfg("block"), flags: { staged: true } });
    spy.mockRestore();
    expect(r.verdict).toBe("approved");
    const said = logs.join("\n");
    expect(said).toMatch(/over the ~150 ideal, within the 200 limit/);
    expect(said).not.toMatch(/ask your user|explicit OK/);
  });

  it("above the limit the warning says partition, and never offers asking for an OK", async () => {
    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    await reviewGateCommand({ config: cfg(undefined), flags: { staged: true } });
    spy.mockRestore();
    const said = logs.join("\n");
    expect(said).toMatch(/over the 200-line limit/);
    expect(said).toMatch(/partition/);
    expect(said).not.toMatch(/ask your user/);
  });

  // KJC-BUG-0434: the CI gate and the policy count NET lines; a pure refactor that rewrites
  // 250 lines in place adds 250 and removes 250, and must not be told to partition.
  it("a refactor that rewrites lines in place is measured net, as in CI", async () => {
    const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
    fs.writeFileSync(path.join(dir, "a.js"), Array.from({ length: 300 }, (_, i) => `old ${i}`).join("\n"));
    git("add", "-A"); git("commit", "-qm", "before the refactor");
    fs.writeFileSync(path.join(dir, "a.js"), Array.from({ length: 300 }, (_, i) => (i < 250 ? `new ${i}` : `old ${i}`)).join("\n"));
    git("add", "a.js");
    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const r = await reviewGateCommand({ config: cfg("block"), flags: { staged: true } });
    spy.mockRestore();
    expect(r.verdict).toBe("approved");
    expect(logs.join("\n")).not.toMatch(/over the 200-line limit/);
  });

  it("default policy stays warn — review proceeds", async () => {
    const r = await reviewGateCommand({ config: cfg(undefined), flags: { staged: true } });
    expect(r.verdict).toBe("approved");
    expect(reviewMock).toHaveBeenCalled();
  });
});
