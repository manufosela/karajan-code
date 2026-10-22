// KJC-TSK-1075 (#2227): a reviewer agent reviews someone else's PR with kj's
// reviewer, the target repo's rules and the provider it picks, and gets one
// JSON document back. No own-work gate applies, and no verdict is stored, so
// this mode can never unlock a commit of one's own (ADR 0015).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOneShotReview } from "../../src/review/one-shot-review.js";
import { loadVerdict, diffHash } from "../../src/review/verdict-store.js";
import { thirdPartyReview, thirdPartyReviewCommand } from "../../src/review/third-party-review.js";

const DIFF = "diff --git a/x.js b/x.js\n+const ok = true;\n";
const output = (approved) => JSON.stringify({
  approved, summary: "s", confidence: 0.8, non_blocking_suggestions: ["n"],
  blocking_issues: approved ? [] : [{ file: "x.js", line: 1, severity: "high", description: "d", suggested_fix: "f" }],
});

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-3p-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("runOneShotReview for a third-party PR", () => {
  it("can run the host's own provider and leaves no verdict behind", async () => {
    const agent = { reviewTask: vi.fn().mockResolvedValue({ ok: true, output: output(true) }) };
    const record = await runOneShotReview({
      diff: DIFF, config: {}, projectDir: dir, hostAgent: "claude",
      reviewerOverride: "claude", persist: false, createAgentFn: () => agent,
    });
    expect(record).toMatchObject({ verdict: "approved", reviewer: "claude" });
    expect(await loadVerdict(dir, diffHash(DIFF))).toBeFalsy();
  });
});

describe("thirdPartyReview", () => {
  it("reviews base...head with the chosen provider and returns findings as JSON data", async () => {
    const run = vi.fn().mockResolvedValue({ verdict: "rejected", reviewer: "claude", summary: "s", issues: JSON.parse(output(false)).blocking_issues, suggestions: ["n"] });
    const res = await thirdPartyReview({
      range: "main...pr", config: { roles: { reviewer: { provider: "claude" } } }, projectDir: dir, logger: { info() {} },
      gitDiff: async () => DIFF, run,
      // KJC-TSK-1076: the PR-requirement checks travel in the same document.
      requirements: async ({ range }) => [{ id: "size", ok: false, detail: `over the limit in ${range}` }],
      // KJC-TSK-1077: the security checks read the same diff; KJC-TSK-1112: and the range, for the repo's allow list.
      security: async ({ diff, range }) => [{ id: "secrets", ok: range === "main...pr", detail: `scanned ${diff.length} chars` }],
      // KJC-TSK-1078: Sonar closes the list.
      sonar: async () => ({ id: "sonar", ok: true, detail: "not available: no SonarQube" }),
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ diff: DIFF, persist: false, reviewerOverride: "claude" }));
    expect(res).toMatchObject({
      mode: "third-party", range: "main...pr", reviewer: "claude",
      verdict: { approved: false, summary: "s" },
      findings: [{ file: "x.js", line: 1, severity: "high", description: "d", suggested_fix: "f" }],
      suggestions: ["n"], checks: [{ id: "secrets", ok: true, detail: `scanned ${DIFF.length} chars` }, { id: "sonar", ok: true, detail: "not available: no SonarQube" }],
      // KJC-BUG-0379 (#2263): the house requirements travel apart, never mixed with the security checks.
      policyChecks: [{ id: "size", ok: false, detail: "over the limit in main...pr" }],
    });
  });
});

// KJC-BUG-0378 (#2263): a large PR was reviewed only up to the reviewer's clip and
// could still come back approved.
describe("thirdPartyReview on a large PR", () => {
  const file = (name, n) => [`diff --git a/${name} b/${name}`, "@@ -1 +1 @@", ...Array.from({ length: n }, (_, i) => `+${name} ${i}`)].join("\n");
  const none = async () => [];
  const review = (diff, run, opts) => thirdPartyReview({
    range: "main...pr", config: {}, projectDir: dir, logger: { info() {} },
    gitDiff: async () => diff, run, requirements: none, security: none, sonar: async () => ({ id: "sonar", ok: true }), ...opts,
  });
  const verdictFor = (rejects) => vi.fn(async ({ diff }) => ({
    reviewer: "claude", summary: "ok", suggestions: [],
    verdict: rejects.some((f) => diff.includes(`a/${f}`)) ? "rejected" : "approved",
    issues: rejects.filter((f) => diff.includes(`a/${f}`)).map((f) => ({ file: f, description: "bug" })),
  }));

  it("reviews every file in batches, and one rejection rejects the review", async () => {
    const diff = [file("a.js", 5), file("b.js", 5), file("c.js", 5)].join("\n");
    const run = verdictFor(["c.js"]);
    const res = await review(diff, run, { limit: file("a.js", 5).length * 2 + 2, maxBatches: 5 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(res.verdict).toMatchObject({ status: "rejected", approved: false });
    expect(res.findings.map((f) => f.file)).toEqual(["c.js"]);
    expect(res.coverage).toMatchObject({ files: { reviewed: 3, total: 3 }, truncated: false });
  });

  it("never approves code it did not review: the verdict is partial and says what was left out", async () => {
    const diff = [file("a.js", 5), file("huge.js", 400)].join("\n");
    const res = await review(diff, verdictFor([]), { limit: file("a.js", 5).length + 1, maxBatches: 5 });
    expect(res.verdict).toMatchObject({ status: "partial", approved: false });
    expect(res.coverage).toMatchObject({ files: { reviewed: 1, total: 2 }, truncated: true, unreviewed: ["huge.js"] });
  });

  // KJC-TSK-1101: a PR over the size budget gets advice on how to split it, apart
  // from the findings and the policy checks, and the verdict does not change.
  it("adds advice.split only over the size budget, without touching findings or verdict", async () => {
    const diff = [file("src/main/java/com/acme/api/A.java", 30), file("src/main/java/com/acme/model/M.java", 30)].join("\n");
    const big = await review(diff, verdictFor([]), { sizeLimit: 40 });
    expect(big.verdict.status).toBe("approved");
    expect(big.findings).toEqual([]);
    expect(big.advice.split.chunks.map((c) => c.name)).toEqual(["model", "api"]);
    const small = await review(diff, verdictFor([]), { sizeLimit: 100 });
    expect(small.advice).toEqual({});
  });

  it("an empty range is an error, never an approval of nothing", async () => {
    await expect(review("", verdictFor([]))).rejects.toThrow(/nothing to review/);
  });
});

describe("thirdPartyReviewCommand", () => {
  const sink = () => { const chunks = []; return { write: (c) => chunks.push(c), text: () => chunks.join("") }; };

  it("prints exactly one JSON document and exits 0 even when the PR has blocking findings", async () => {
    const out = sink();
    const code = await thirdPartyReviewCommand({
      flags: { range: "main...pr", json: true }, config: {}, out, err: sink(),
      review: async () => ({ verdict: { approved: false }, findings: [{ file: "x.js" }] }),
    });
    expect(code).toBe(0);
    expect(JSON.parse(out.text())).toMatchObject({ verdict: { approved: false } });
  });

  // KJC-TSK-1117: --lens qa hands the reviewer the QA rubric before the task; an unknown lens is a JSON error.
  it("passes the QA rubric as the task with --lens qa", async () => {
    let seen = null;
    const review = async ({ task }) => { seen = task; return { verdict: { approved: true } }; };
    expect(await thirdPartyReviewCommand({ flags: { range: "main...pr", lens: "qa", task: "checkout tests" }, config: {}, out: sink(), err: sink(), review })).toBe(0);
    expect(seen).toMatch(/Review lens: QA[\s\S]*checkout tests$/);
    const out = sink();
    expect(await thirdPartyReviewCommand({ flags: { range: "main...pr", lens: "ux" }, config: {}, out, err: sink(), review })).toBe(1);
    expect(JSON.parse(out.text()).error).toMatch(/unknown review lens/);
  });

  it("needs --range, and a kj failure is a JSON error with a non-zero code", async () => {
    const out = sink();
    expect(await thirdPartyReviewCommand({ flags: { json: true }, config: {}, out, err: sink() })).toBe(1);
    expect(JSON.parse(out.text()).error).toMatch(/--range/);
    const out2 = sink();
    const code = await thirdPartyReviewCommand({
      flags: { range: "a...b", json: true }, config: {}, out: out2, err: sink(),
      review: async () => { throw new Error("nothing to review"); },
    });
    expect(code).toBe(1);
    expect(JSON.parse(out2.text()).error).toMatch(/nothing to review/);
  });
});
