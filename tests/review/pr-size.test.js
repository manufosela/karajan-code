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
  ...(await orig()), runSonarPregate: vi.fn().mockResolvedValue({ available: false, reason: "test" }),
}));
vi.mock("../../src/review/card-first.js", async (orig) => ({
  ...(await orig()), checkCardFirst: vi.fn().mockResolvedValue({ ok: true, mode: "pass" }),
}));

import { reviewGateCommand } from "../../src/commands/review-gate.js";

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
  process.chdir(dir);
  reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789" });
});

const cfg = (pr_size) => ({ projectDir: dir, method_gates: { pr_size, pr_size_warn: 150 } });

describe("pr-size policy", () => {
  it("block rejects an oversized diff WITHOUT invoking the reviewer, naming the escape", async () => {
    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const r = await reviewGateCommand({ config: cfg("block"), flags: { staged: true } });
    spy.mockRestore();
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "pr-size" });
    expect(reviewMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(logs.join("\n")).toMatch(/KJ_ALLOW_LARGE_PR/);
  });

  it("KJ_ALLOW_LARGE_PR=1 is the explicit, visible escape", async () => {
    process.env.KJ_ALLOW_LARGE_PR = "1";
    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const r = await reviewGateCommand({ config: cfg("block"), flags: { staged: true } });
    spy.mockRestore();
    expect(r.verdict).toBe("approved");
    expect(logs.join("\n")).toMatch(/pr-size exempt/i);
  });

  it("default policy stays warn — review proceeds", async () => {
    const r = await reviewGateCommand({ config: cfg(undefined), flags: { staged: true } });
    expect(r.verdict).toBe("approved");
    expect(reviewMock).toHaveBeenCalled();
  });
});
