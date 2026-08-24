// KJC-BUG-0146 — the SECOND half of the bug: yesterday's fix taught
// normalizeReviewPayload to unwrap {ok, result}, and the test was green — but the
// path `kj review` actually uses calls parseMaybeJsonString, which only PARSES.
// The wrapper survived, the reviews kept failing, and the green test was proving
// a function nobody called on that path.
//
// So this test pins the COMBINATION exactly as one-shot-review uses it, with the
// output copied from a real codex answer. A test can only prove the code it runs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseMaybeJsonString, normalizeReviewPayload } from "../../src/review/parser.js";
import { runOneShotReview } from "../../src/review/one-shot-review.js";

/** What one-shot-review does with the reviewer's stdout. */
const asReviewUses = (output) => normalizeReviewPayload(parseMaybeJsonString(output));

describe("the verdict path kj review actually walks", () => {
  it("reads a wrapped approval — the shape that produced ten unparseable verdicts", () => {
    const raw = JSON.stringify({
      ok: true,
      result: { approved: true, blocking_issues: [], non_blocking_suggestions: ["use String.raw"], confidence: 0.84 },
      summary: "Approved: no blocking issues",
    });
    const verdict = asReviewUses(raw);
    expect(typeof verdict?.approved).toBe("boolean"); // the exact check one-shot-review makes
    expect(verdict).toMatchObject({ approved: true, confidence: 0.84 });
  });

  it("reads a wrapped rejection: a wrapper must never turn a no into a lost verdict", () => {
    const raw = JSON.stringify({ ok: true, result: { approved: false, blocking_issues: [{ id: "leak", severity: "high" }] } });
    expect(asReviewUses(raw)).toMatchObject({ approved: false });
    expect(asReviewUses(raw).blocking_issues).toHaveLength(1);
  });

  it("still reads a plain, unwrapped verdict", () => {
    const raw = JSON.stringify({ approved: true, blocking_issues: [] });
    expect(asReviewUses(raw)).toMatchObject({ approved: true });
  });

  it("prose with a wrapped verdict inside it is read too (CLIs like to chat before the JSON)", () => {
    const raw = `Reviewing the diff…\n${JSON.stringify({ ok: true, result: { approved: true, blocking_issues: [] } })}`;
    expect(asReviewUses(raw)).toMatchObject({ approved: true });
  });

  it("what is NOT a verdict stays unreadable: unwrapping is not guessing", () => {
    expect(asReviewUses(JSON.stringify({ ok: true, result: { status: "done" } }))).toBeNull();
    expect(asReviewUses("no json here at all")).toBeNull();
    expect(asReviewUses("")).toBeNull();
  });
});

// The tests above prove the FUNCTIONS. That is exactly the trap this bug fell into
// twice: green on a helper the real path never called. These run runOneShotReview
// itself, so they fail if the wiring is wrong no matter how right the helpers are.
describe("runOneShotReview against a reviewer that wraps its answer", () => {
  let dir;
  const config = { roles: { reviewer: { provider: "codex" } } };
  const agentThatAnswers = (output) => () => ({ reviewTask: async () => ({ ok: true, output }) });
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verdict-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const review = (output) => runOneShotReview({
    diff: "diff --git a/x b/x\n+1", task: "t", config, projectDir: dir, hostAgent: "claude",
    createAgentFn: agentThatAnswers(output),
    detectAgents: async () => [{ name: "codex", available: true }],
  });

  it("stores the verdict instead of refusing it — the whole point of the bug", async () => {
    const record = await review(JSON.stringify({ ok: true, result: { approved: true, blocking_issues: [], confidence: 0.9 } }));
    expect(record).toMatchObject({ verdict: "approved", reviewer: "codex", confidence: 0.9 });
  });

  it("a wrapped rejection is stored as rejected, with its issues", async () => {
    const record = await review(JSON.stringify({ ok: true, result: { approved: false, blocking_issues: [{ id: "leak" }] } }));
    expect(record).toMatchObject({ verdict: "rejected" });
    expect(record.issues).toHaveLength(1);
  });

  it("an answer that carries no verdict is still refused, with the evidence saved", async () => {
    await expect(review("I could not review this")).rejects.toThrow(/no parseable verdict/);
    const saved = fs.readdirSync(path.join(dir, ".karajan", "reviews"));
    expect(saved.some((f) => f.endsWith(".unparseable.txt"))).toBe(true);
  });
});
