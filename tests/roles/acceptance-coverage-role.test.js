// KJC-TSK-0987 (issue #1894): the judge that reads each acceptance criterion of
// the card against the diff; a missing or unreadable verdict is never an approval.
import { describe, expect, it, vi } from "vitest";
import { AcceptanceCoverageRole, criteriaOfCard } from "../../src/roles/acceptance-coverage-role.js";
import { buildAcceptanceCoveragePrompt } from "../../src/prompts/acceptance-coverage.js";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
const CRITERIA = ["Given a visitor, when they log in with Google, then only the corporate domain is accepted", "Given a user, when they open the home, then their name is shown"];
const run = (output, config = { roles: { coder: { provider: "claude" }, reviewer: { provider: "codex" } } }) =>
  new AcceptanceCoverageRole({ config, logger: log, createAgentFn: () => ({ async runTask() { return { ok: true, output, usage: {} }; } }) })
    .execute({ task: "login", criteria: CRITERIA, diff: "+ signInWithGoogle(hd: 'acme.com')" });

describe("criteriaOfCard", () => {
  it("structured Given/When/Then first, raw entries kept, else the free text one per line or bullet", () => {
    expect(criteriaOfCard({ acceptanceCriteriaStructured: [{ given: "a", when: "b", then: "c" }, { raw: "plain one" }, {}] }))
      .toEqual(["Given a, when b, then c", "plain one"]);
    expect(criteriaOfCard({ acceptanceCriteria: "- first\n* second\n3) third\n\n" })).toEqual(["first", "second", "third"]);
    expect(criteriaOfCard(null)).toEqual([]);
  });
});

describe("AcceptanceCoverageRole", () => {
  it("the prompt numbers the criteria, carries the diff and asks for one entry per criterion", () => {
    const p = buildAcceptanceCoveragePrompt({ criteria: CRITERIA, diff: "+ x", task: "login", instructions: "EXTRA" });
    expect(p).toContain("1. Given a visitor");
    expect(p).toContain("2. Given a user");
    expect(p).toContain("+ x");
    expect(p).toContain("EXTRA");
    expect(p).toMatch(/One entry per criterion/);
  });

  it("judges with the reviewer's provider, never the coder's", () => {
    const role = new AcceptanceCoverageRole({ config: { roles: { coder: { provider: "claude" }, reviewer: { provider: "codex" } } }, logger: log });
    expect(role.resolveProvider()).toBe("codex");
  });

  it("a verdict per criterion: the uncovered ones are listed; one the judge left out counts as uncovered", async () => {
    const res = await run(JSON.stringify({ criteria: [{ index: 1, covered: true, evidence: "auth.js: hd param" }] }));
    expect(res.ok).toBe(true);
    expect(res.result.criteria).toEqual([
      { index: 1, text: CRITERIA[0], covered: true, evidence: "auth.js: hd param" },
      { index: 2, text: CRITERIA[1], covered: false, evidence: "" },
    ]);
    expect(res.result.uncovered.map((c) => c.index)).toEqual([2]);
    expect(res.summary).toMatch(/1 of 2 criteria NOT covered/);
  });

  it("all covered says so", async () => {
    const res = await run(JSON.stringify({ criteria: [{ index: 1, covered: true, evidence: "a" }, { index: 2, covered: true, evidence: "b" }] }));
    expect(res.result.uncovered).toEqual([]);
    expect(res.summary).toBe("acceptance-coverage: 2/2 criteria covered");
  });

  it("no JSON, or JSON without a criteria array, is the judge's failure, never an approval", async () => {
    expect((await run("all good, trust me")).ok).toBe(false);
    const res = await run(JSON.stringify({ approved: true }));
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/unreadable verdict/);
  });
});
