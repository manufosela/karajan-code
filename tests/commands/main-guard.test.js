// KJC-TSK-1369 (ADR 0037, step 2 of KJC-TSK-1269): `kj main-guard` audits a push to main
// against GitHub and fails with a markdown report the sealed workflow posts as the alarm.
import { describe, expect, it } from "vitest";
import { pushedCommits, renderReport, runMainGuard } from "../../src/commands/main-guard.js";

const ZERO = "0000000000000000000000000000000000000000";
const clean = { ok: true, merges: [], protection: [] };
const dirty = {
  ok: false,
  merges: [
    { sha: "abc1234def", kind: "checks-skipped", pr: 11, mergedBy: "someone", missing: ["policy-check"] },
    { sha: "fff0000aaa", kind: "direct-push", detail: "no pull request merged into main" },
  ],
  protection: ["enforce_admins is off: admins can merge past the required checks"],
};

describe("commands/main-guard — KJC-TSK-1369", () => {
  it("the pushed commits are the first-parent ones between before and after; a new branch audits only its tip", () => {
    const calls = [];
    const git = (args) => { calls.push(args.join(" ")); return "m2\nm1\n"; };
    expect(pushedCommits({ before: "b0", after: "m2", git })).toEqual(["m2", "m1"]);
    expect(calls).toEqual(["rev-list --first-parent b0..m2"]);
    expect(pushedCommits({ before: ZERO, after: "m2", git })).toEqual(["m2"]);
  });

  it("the report names each PR, who merged it, what was missing, and what changed in the protection", () => {
    const md = renderReport(dirty, { repo: "acme/app", branch: "main" });
    expect(md).toMatch(/PR #11.*merged by @someone.*policy-check/);
    expect(md).toMatch(/fff0000.*direct push/i);
    expect(md).toMatch(/enforce_admins is off/);
    expect(renderReport(clean, { repo: "acme/app", branch: "main" })).toMatch(/nothing reached main without its checks/i);
  });

  it("fails (exit 1) when something is wrong and passes (exit 0) when all is in order", async () => {
    const opts = { repo: "acme/app", branch: "main", before: "b0", after: "m1", require: ["policy-check"], git: () => "m1\n" };
    const out = [];
    const print = (s) => out.push(s);
    expect(await runMainGuard({ ...opts, audit: async () => dirty, print })).toBe(1);
    expect(out.join("\n")).toMatch(/PR #11/);
    expect(await runMainGuard({ ...opts, audit: async () => clean, print })).toBe(0);
  });

  it("passes the commits and the declared checks to the audit", async () => {
    let seen;
    await runMainGuard({ repo: "acme/app", branch: "main", before: "b0", after: "m1", require: ["a", "b"], git: () => "m1\n", audit: async (args) => { seen = args; return clean; }, print: () => {} });
    expect(seen).toMatchObject({ branch: "main", commits: ["m1"], requiredChecks: ["a", "b"] });
  });
});
