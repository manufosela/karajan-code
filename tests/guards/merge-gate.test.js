// KJC-BUG-0494: a PR was merged while its CI was still running. Before gh pr merge, kj reads
// the PR's checks: one running or red stops it; no check yet in a repo with CI stops it too.
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

import { exceptionFiles, renderException } from "../../src/guards/main-guard-exception.js";
import { checksVerdict, mergeGate, mergeTarget } from "../../src/guards/merge-gate.js";
import { canonicalPayload } from "../../src/harden/phone-sign.js";

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
    expect(calls[0]).toEqual(["gh", "pr", "view", "12", "--repo", "o/r", "--json", "statusCheckRollup,url,number,headRefOid,baseRefName,comments"]);
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

// HU-4969 (#4964): the maintainer's signed main-guard exception lets a red merge through.
describe("mergeGate with a main-guard exception", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signer = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
  const exception = { repo: "o/r", pr: 12, head: "abc1234def", why: "transition merge" };

  const comment = (over = {}, key = privateKey) => {
    const fields = { ...exception, ...over };
    const challenge = { cid: "c1", nonce: "n1", project: "r", v: 2, kjVersion: "5.5.0", issuedMs: 1, expiresMs: 2 };
    const payload = Buffer.from(canonicalPayload({ ...challenge, files: exceptionFiles(fields) }), "utf8");
    return renderException({ ...fields, signature: { ...challenge, signer, signature: sign(null, payload, key).toString("base64") } });
  };
  const ok = (stdout) => ({ status: 0, stdout, stderr: "" });
  const failed = (stderr) => ({ status: 1, stdout: "", stderr });
  // As the contents API gives it: base64 wrapped in lines.
  const rosterFile = (publicKey) => ok(`${Buffer.from(JSON.stringify({ signers: [{ publicKey }] })).toString("base64").replace(/.{60}/g, "$&\n")}\n`);
  const verdictOn = (rollup, bodies, { base = "main", defaultBranch = ok("main\n"), roster = rosterFile(signer) } = {}) => {
    const view = { statusCheckRollup: rollup, url: "https://github.com/o/r/pull/12", number: 12, headRefOid: exception.head, baseRefName: base, comments: bodies.map((body) => ({ body })) };
    const api = { "repos/o/r": defaultBranch, "repos/o/r/contents/.karajan/supervisor-signers.json?ref=main": roster };
    return mergeGate({ command: "gh pr merge 12", run: (cmd, args) => (args[0] === "api" ? api[args[1]] ?? failed("HTTP 404") : ok(JSON.stringify(view))) });
  };
  const red = [done("a"), done("lint", "FAILURE"), done("scan", "FAILURE")];

  it("lets red checks through, naming them, the signer and the reason", () => {
    expect(verdictOn(red, ["looks good", comment()])).toEqual({ ok: true, note: `red: lint, scan, merged under the main-guard exception signed by ${signer}: transition merge` });
  });

  it("says the signed exception is for another head", () => {
    const v = verdictOn(red, [comment({ head: "fff0000aaa" })]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/^red: lint, scan; the exception for #12 .*fff0000.*abc1234/);
  });

  it("says the signature does not verify when its key is not in the roster", () => {
    const { privateKey: other } = generateKeyPairSync("ed25519");
    const v = verdictOn(red, [comment({}, other)]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/^red: lint, scan; the exception for #12 .*firma/);
  });

  it("refuses a PR that targets another branch than the default one on GitHub, naming both", () => {
    expect(verdictOn(red, [comment()], { base: "agent-base" })).toEqual({ ok: false, reason: "red: lint, scan; the main-guard exception covers only merges into main, this PR targets agent-base" });
  });

  it("refuses, naming what it could not read, when GitHub gives no default branch or no roster", () => {
    for (const defaultBranch of [failed("HTTP 502"), ok("\n")]) {
      const v = verdictOn(red, [comment()], { defaultBranch });
      expect(v.ok).toBe(false);
      expect(v.reason).toMatch(/^red: lint, scan; could not read the default branch of o\/r from GitHub/);
    }
    const v = verdictOn(red, [comment()], { roster: failed("HTTP 404") });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/^red: lint, scan; could not read \.karajan\/supervisor-signers\.json on main from GitHub: HTTP 404; the exception for #12 .*firma/);
  });

  it("trusts only the roster GitHub returns for the base branch", () => {
    const v = verdictOn(red, [comment()], { roster: rosterFile("another-key") });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/^red: lint, scan; the exception for #12 .*firma/);
  });

  it("stops while a check is still running, exception or not", () => {
    expect(verdictOn([...red, run("Test", "IN_PROGRESS", null)], [comment()])).toEqual({ ok: false, reason: "still running: Test; red: lint, scan" });
  });

  it("keeps the refusal as it was with no exception for this PR", () => {
    for (const bodies of [[], ["plain", "```kj-exception\nnull\n```"], [comment({ pr: 13 })], [comment({ repo: "o/other" })]]) {
      expect(verdictOn(red, bodies)).toEqual({ ok: false, reason: "red: lint, scan" });
    }
  });
});
