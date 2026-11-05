// KJC-BUG-0494: a PR was merged while its CI was still running. Before gh pr merge, kj reads
// the PR's checks: one running or red stops it; no check yet in a repo with CI stops it too.
import { describe, expect, it } from "vitest";

import { checksVerdict, mergeGate, mergeTarget } from "../../src/guards/merge-gate.js";

const run = (name, status, conclusion, startedAt = "2026-11-05T10:00:00Z") => ({ __typename: "CheckRun", workflowName: "CI", name, status, conclusion, startedAt });
const done = (name, conclusion = "SUCCESS", startedAt) => run(name, "COMPLETED", conclusion, startedAt);

describe("mergeTarget", () => {
  it("reads the PR, the repo and --auto from the merge, after an account switch", () => {
    expect(mergeTarget("gh auth switch --user me && gh pr merge 12 --repo o/r --merge")).toEqual({ selector: "12", repo: "o/r", auto: false });
    expect(mergeTarget("gh pr merge -R o/r --squash --auto")).toEqual({ selector: null, repo: "o/r", auto: true });
    expect(mergeTarget("gh pr merge --subject 'a b' 7")).toEqual({ selector: "7", repo: null, auto: false });
    expect(mergeTarget(`gh pr merge "12" --repo "o/r"`)).toEqual({ selector: "12", repo: "o/r", auto: false });
    for (const r of ["-R=o/r", "-Ro/r", "--repo=o/r"]) expect(mergeTarget(`gh pr merge 12 ${r}`)?.repo, r).toBe("o/r");
  });

  it("sees the merge through the spellings the shell runs as gh pr merge", () => {
    for (const cmd of ["gh pr \\\nmerge 12", "g\\h pr merge 12", `"gh" pr 'merge' 12`, "$(printf gh) pr merge 12"]) expect(mergeTarget(cmd)?.selector, cmd).toBe("12");
    expect(mergeTarget("gh pr -R o/r merge 12")).toEqual({ selector: "12", repo: "o/r", auto: false });
    for (const cmd of ["gh-ox pr merge 12", "$GH pr merge 12"]) expect(mergeTarget(cmd)?.selector, cmd).toBe("12");
  });

  it("is null for any command that merges no PR", () => {
    expect(mergeTarget("gh pr view 12")).toBeNull();
    expect(mergeTarget("git merge main")).toBeNull();
    expect(mergeTarget(`git commit -m "fix pr merge"`)).toBeNull();
    expect(mergeTarget(`gh pr create --title "a pr to merge"`)).toBeNull();
    expect(mergeTarget("some-tool pr merge 12")).toBeNull();
    expect(mergeTarget("gh pr view merge")).toBeNull();
    expect(mergeTarget("gh pr create --title merge")).toBeNull();
  });
});

describe("checksVerdict", () => {
  it("passes when every check finished green, skipped or neutral", () => {
    expect(checksVerdict([done("a"), done("b", "SKIPPED"), done("c", "NEUTRAL")], { hasWorkflows: true })).toEqual({ ok: true });
  });

  it("stops on a check still running, and names it", () => {
    const v = checksVerdict([done("a"), run("Test", "IN_PROGRESS", null)], { hasWorkflows: true });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/still running: Test/);
  });

  it("stops on a red check or a pending commit status", () => {
    expect(checksVerdict([done("lint", "FAILURE")], { hasWorkflows: true }).reason).toMatch(/red: lint/);
    expect(checksVerdict([done("x", "CANCELLED")], { hasWorkflows: true }).ok).toBe(false);
    expect(checksVerdict([{ __typename: "StatusContext", context: "ci/ext", state: "PENDING" }], { hasWorkflows: true }).reason).toMatch(/still running: ci\/ext/);
  });

  it("judges each check by its latest run: an old red run under a newer green one passes", () => {
    const old = done("verdicts", "FAILURE", "2026-11-05T10:00:00Z");
    const fresh = done("verdicts", "SUCCESS", "2026-11-05T11:00:00Z");
    expect(checksVerdict([fresh, old], { hasWorkflows: true })).toEqual({ ok: true });
  });

  it("with no check yet, stops only a repo that has CI", () => {
    expect(checksVerdict([], { hasWorkflows: true }).reason).toMatch(/no check yet/);
    expect(checksVerdict([], { hasWorkflows: false })).toEqual({ ok: true });
  });
});

describe("mergeGate", () => {
  const gh = (rollup, workflows = "3", url = "https://github.com/o/r/pull/12") => (cmd, args) => {
    if (args[0] === "api") return { status: 0, stdout: args[1] === "repos/o/r/actions/workflows" ? workflows : "0", stderr: "" };
    return { status: 0, stdout: JSON.stringify({ statusCheckRollup: rollup, url }), stderr: "" };
  };

  it("asks gh for the merged PR's checks in its repo", () => {
    const calls = [];
    mergeGate({ command: "gh pr merge 12 --repo o/r --merge", run: (cmd, args) => { calls.push([cmd, ...args]); return gh([done("a")])(cmd, args); } });
    expect(calls[0]).toEqual(["gh", "pr", "view", "12", "--repo", "o/r", "--json", "statusCheckRollup,url"]);
  });

  it("lets --auto through without asking: GitHub waits for the checks", () => {
    expect(mergeGate({ command: "gh pr merge 12 --auto --merge", run: () => { throw new Error("no call"); } })).toEqual({ ok: true });
  });

  it("stops the merge while CI runs, and when the repo has CI but no check yet", () => {
    expect(mergeGate({ command: "gh pr merge 12", run: gh([run("Test", "QUEUED", null)]) }).ok).toBe(false);
    expect(mergeGate({ command: "gh pr merge 12", run: gh([]) }).ok).toBe(false);
    expect(mergeGate({ command: "gh pr merge 12", run: gh([], "0") })).toEqual({ ok: true });
  });

  it("looks for CI in the PR's own repo, not the current one, when it has no check yet", () => {
    expect(mergeGate({ command: "gh pr merge https://github.com/o/r/pull/12", run: gh([]) }).ok).toBe(false);
  });

  it("stops, with gh's reason, when the checks cannot be read", () => {
    const v = mergeGate({ command: "gh pr merge 12", run: () => ({ status: 1, stdout: "", stderr: "no pull requests found" }) });
    expect(v).toEqual({ ok: false, reason: "could not read the PR's checks: no pull requests found" });
  });
});
