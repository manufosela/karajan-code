// KJC-TSK-0849 (ADR 0010, RAG-C) — the review gate reads the session's RAG
// ledger: code the RAG never answered about is rejected before any reviewer
// token; the twins it returned travel to the reviewer; the verdict carries the
// rag block and --check demands it. No harness = no ledger = said, not blocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const reviewMock = vi.fn();
vi.mock("../../src/review/sonar-pregate.js", async (orig) => ({
  ...(await orig()),
  runSonarPregate: async () => ({ available: true, projectKey: "k", blocking: [], advisory: [], totalProject: 0, covered: ["a.js"], uncovered: [] }),
}));
vi.mock("../../src/review/one-shot-review.js", () => ({ runOneShotReview: (...a) => reviewMock(...a) }));

import { reviewGateCommand } from "../../src/commands/review-gate.js";
import { saveVerdict } from "../../src/review/verdict-store.js";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gate-rag-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  git("add", "a.js"); git("commit", "-qm", "base");
  fs.writeFileSync(path.join(dir, "a.js"), "y\n");
  git("add", "a.js");
  process.chdir(dir);
  reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789", summary: "" });
});

const cfg = () => ({ projectDir: dir });
// A REAL harness (the installed kj's own scripts, so it verifies) with a seeded session.
const harness = (session) => {
  installSentinelHooks({ projectDir: dir, logger: { info() {}, warn() {} } });
  const h = path.join(dir, ".karajan", "harness");
  if (session) fs.writeFileSync(path.join(h, "sentinel-state.json"), JSON.stringify({ sessions: { s1: { at: 1, ...session } } }));
};
const staged = () => execFileSync("git", ["-C", dir, "diff", "--cached"], { encoding: "utf8" });

describe("review gate × rag requirement", () => {
  it("rejects code the session never asked the RAG about, before any reviewer token", async () => {
    harness({ rag_hits: ["lib/other.js"], rag_queries: [{ text: "q", hits: ["lib/other.js"] }] });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true } });
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "rag-first" });
    expect(r.issues[0].description).toContain("a.js");
    expect(reviewMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("hands the reviewer the rag block and names the untouched twins in its task", async () => {
    harness({ rag_hits: ["a.js", "lib/twin.js"], rag_queries: [{ text: "q", hits: ["a.js", "lib/twin.js"] }] });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true, task: "my intent" } });
    expect(r.verdict).toBe("approved");
    const call = reviewMock.mock.calls[0][0];
    expect(call.rag).toEqual({ mode: "pass", sessionId: "s1", queries: 1, covered: ["a.js"], uncovered: [], twinsUntouched: ["lib/twin.js"] });
    expect(call.task).toContain("my intent");
    expect(call.task).toContain("- lib/twin.js");
  });

  it("without a Sentinel harness the requirement stands down and says so; a harness that does not verify fails closed", async () => {
    expect((await reviewGateCommand({ config: cfg(), flags: { staged: true } })).verdict).toBe("approved");
    expect(reviewMock.mock.calls[0][0].rag.mode).toBe("no-harness");
    // An empty or hand-made harness dir is not the Sentinel: nothing it says counts.
    fs.mkdirSync(path.join(dir, ".karajan", "harness"), { recursive: true });
    const r = await reviewGateCommand({ config: cfg(), flags: { staged: true } });
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "rag-first" });
    expect(r.issues[0].description).toMatch(/does not match the installed kj/);
  });

  it("--check demands the rag block of the verdict for code, and accepts a proved one", async () => {
    harness({ rag_hits: ["a.js"], rag_queries: [{ text: "q", hits: ["a.js"] }] });
    const sonar = { ran: true, projectKey: "k", covered: ["a.js"], uncovered: [], blocking: 0, advisory: 0, mode: "pass" };
    await saveVerdict(dir, staged(), { verdict: "approved", reviewer: "codex", issues: [], sonar });
    const blind = await reviewGateCommand({ config: cfg(), flags: { check: true } });
    expect(blind.ok).toBe(false);
    expect(blind.reason).toMatch(/no rag block/);
    await saveVerdict(dir, staged(), { verdict: "approved", reviewer: "codex", issues: [], sonar, rag: { mode: "pass", covered: ["a.js"], uncovered: [], twinsUntouched: [] } });
    expect((await reviewGateCommand({ config: cfg(), flags: { check: true } })).ok).toBe(true);
  });

  it("--check accepts a pipeline verdict without a ledger, but seals the rag rule as a WARN in the decision log", async () => {
    harness({ rag_hits: [], rag_queries: [] });
    const sonar = { ran: true, source: "pipeline", projectKey: "k", gateStatus: "OK", covered: [], uncovered: [] };
    await saveVerdict(dir, staged(), { verdict: "approved", reviewer: "codex", host: "kj-pipeline", issues: [], sonar });
    expect((await reviewGateCommand({ config: cfg(), flags: { check: true } })).ok).toBe(true);
    const decisions = fs.readFileSync(path.join(dir, ".karajan", "policy-decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(decisions.at(-1)).toMatchObject({ decision: "allow", chokepoint: "commit", warn_rule_ids: ["method.rag.code"] });
  });
});
