// KJC-TSK-1369 (ADR 0037, step 2 of KJC-TSK-1269): `kj main-guard` audits a push to main
// against GitHub and fails with a markdown report the sealed workflow posts as the alarm.
import { describe, expect, it } from "vitest";
import { githubApi, pushedCommits, renderReport, runMainGuard } from "../../src/commands/main-guard.js";

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

  // KJC-TSK-1402: the audit gets the repo and the roster keys, and what passed on an exception is said.
  it("passes the repo and the roster keys, and names each merge that passed on a signed exception", async () => {
    let seen;
    const keys = new Set(["k1"]);
    const excepted = { ...clean, exceptions: [{ sha: "abcdef0123", pr: 7, mergedBy: "manufosela", missing: ["quality"], why: "transition merge" }] };
    await runMainGuard({ repo: "acme/app", branch: "main", before: "b0", after: "m1", require: ["a"], keys, git: () => "m1\n", audit: async (args) => { seen = args; return excepted; }, print: () => {} });
    expect(seen).toMatchObject({ repo: "acme/app", keys });
    const md = renderReport(excepted, { repo: "acme/app", branch: "main" });
    expect(md).toMatch(/PR #7 merged by @manufosela without quality, on the maintainer's signed exception: transition merge/);
  });
});

// HU-3747: GitHub may not have linked a just-pushed merge to its PR yet, and gh calls fail transiently.
describe("githubApi retries — HU-3747", () => {
  const mk = (answers) => {
    const calls = [];
    const sleeps = [];
    const run = (path) => {
      calls.push(path);
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return JSON.stringify(a);
    };
    return { calls, sleeps, api: githubApi({ repo: "acme/app", branch: "main", run, sleep: async (ms) => { sleeps.push(ms); } }) };
  };

  it("asks again once when the pulls answer is empty, and takes the PR the second answer brings", async () => {
    const { api, calls, sleeps } = mk([[], [{ number: 5, merged_at: null }]]);
    expect(await api.pullsOf("m1")).toEqual([{ number: 5, merged_at: null }]);
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });

  it("a commit still without a PR after the retry stays empty: a direct push", async () => {
    const { api, calls } = mk([[], []]);
    expect(await api.pullsOf("m1")).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("retries a failed check-runs call once; a second failure throws naming the command", async () => {
    const boom = () => new Error("Command failed: gh api check-runs");
    const ok = mk([boom(), { check_runs: [{ name: "a", conclusion: "success" }] }, { statuses: [] }]);
    expect(await ok.api.checksOf("m1")).toEqual([{ name: "a", conclusion: "success" }]);
    const bad = mk([boom(), boom()]);
    await expect(bad.api.checksOf("m1")).rejects.toThrow(/Command failed: gh api check-runs/);
  });
});
