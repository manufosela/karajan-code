// KJC-TSK-0928 (M15-B): the method's CI checks become required on the base
// branch. kj never applies the protection (it needs admin): it says the exact command.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adviseBranchProtection, requiredChecksFrom, protectionAdvice } from "../../src/harden/branch-protection.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-protection-"));
  const wf = path.join(dir, ".github", "workflows");
  fs.mkdirSync(wf, { recursive: true });
  fs.writeFileSync(path.join(wf, "kj-policy.yml"), "name: Policy\non:\n  pull_request:\njobs:\n  policy-check:\n    runs-on: ubuntu-latest\n");
  fs.writeFileSync(path.join(wf, "kj-quality.yml"), "name: Quality\njobs:\n  quality:\n    name: \"Lint and tests\"\n    runs-on: ubuntu-latest\n");
  fs.writeFileSync(path.join(wf, "kj-mutation.yml"), "name: Mutation\njobs:\n  mutation:\n    runs-on: ubuntu-latest\n");
  fs.writeFileSync(path.join(wf, "ci.yml"), "name: CI\njobs:\n  test:\n    runs-on: ubuntu-latest\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const repo = { owner: "acme", repo: "app", branch: "main" };
const gh = (result) => async () => result;

describe("adviseBranchProtection", () => {
  const remote = (url) => async (cmd, args) => (cmd === "git" ? { exitCode: 0, stdout: `${url}\n` } : { exitCode: 1, stdout: "", stderr: "Branch not protected (HTTP 404)" });

  it("on a GitHub remote it warns with the exact command, and never applies it", async () => {
    const out = [];
    const calls = [];
    const run = async (cmd, args) => { calls.push([cmd, ...args].join(" ")); return remote("git@github.com:acme/app.git")(cmd, args); };
    const a = await adviseBranchProtection({ projectDir: dir, branch: "main", logger: { warn: (l) => out.push(l), info: (l) => out.push(l) }, run });
    expect(a.status).toBe("unprotected");
    expect(out.join("\n")).toMatch(/main is not protected.*\n.*gh api -X PUT repos\/acme\/app\/branches\/main\/protection/);
    expect(calls.some((c) => c.includes("-X PUT"))).toBe(false);
  });

  // KJC-BUG-0401: with another account active, gh answered 404 and kj said "not protected".
  it("with a gh account other than the declared one, it says so instead of reading the protection", async () => {
    const out = [];
    const calls = [];
    const run = async (cmd, args) => { calls.push(cmd); return remote("git@github.com:acme/app.git")(cmd, args); };
    const identity = () => { throw new Error("the active gh account is other and this clone declares acme-dev: run gh auth switch --user acme-dev and retry"); };
    const a = await adviseBranchProtection({ projectDir: dir, branch: "main", logger: { warn: (l) => out.push(l) }, run, identity });
    expect(a.status).toBe("unverified");
    expect(out.join("\n")).toMatch(/gh auth switch --user acme-dev/);
    expect(calls).not.toContain("gh");
  });

  it("not a GitHub remote, or no kj workflow: nothing to say", async () => {
    expect(await adviseBranchProtection({ projectDir: dir, branch: "main", logger: {}, run: remote("https://gitlab.com/acme/app.git") })).toBeNull();
    expect(await adviseBranchProtection({ projectDir: dir, branch: "main", logger: {}, run: remote("git@github.com:acme/app;rm -rf ~.git") })).toBeNull();
    fs.rmSync(path.join(dir, ".github"), { recursive: true, force: true });
    expect(await adviseBranchProtection({ projectDir: dir, branch: "main", logger: {}, run: remote("git@github.com:acme/app.git") })).toBeNull();
  });
});

describe("requiredChecksFrom", () => {
  it("names the job of each kj workflow, by its name when it has one; mutation and the user's own CI stay out", () => {
    expect(requiredChecksFrom(dir)).toEqual(["policy-check", "Lint and tests"]);
  });
});

describe("protectionAdvice", () => {
  it("an unprotected branch gets the exact command that protects it with the checks required", async () => {
    const a = await protectionAdvice({ ...repo, checks: ["policy-check"], run: gh({ exitCode: 1, stdout: "", stderr: "gh: Branch not protected (HTTP 404)" }) });
    expect(a.status).toBe("unprotected");
    expect(a.command).toMatch(/gh api -X PUT repos\/acme\/app\/branches\/main\/protection/);
    expect(a.command).toMatch(/required_status_checks\[contexts\]\[\]=policy-check/);
    expect(a.command).toMatch(/allow_force_pushes=false/);
    // KJC-BUG-0401: an agent working with an admin's token must be bound too.
    expect(a.command).toMatch(/enforce_admins=true/);
  });

  it("KJC-BUG-0401: required checks that admins can skip get the command that binds admins too", async () => {
    const run = gh({ exitCode: 0, stdout: JSON.stringify({ required_status_checks: { contexts: ["policy-check"] }, enforce_admins: { enabled: false } }) });
    const a = await protectionAdvice({ ...repo, checks: ["policy-check"], run });
    expect(a).toMatchObject({ status: "admins-exempt", command: "gh api -X POST repos/acme/app/branches/main/protection/enforce_admins" });
    const bound = gh({ exitCode: 0, stdout: JSON.stringify({ required_status_checks: { contexts: ["policy-check"] }, enforce_admins: { enabled: true } }) });
    expect((await protectionAdvice({ ...repo, checks: ["policy-check"], run: bound })).status).toBe("ok");
  });

  it("KJC-BUG-0401: missing checks with admins exempt get both commands, never only the checks", async () => {
    const run = gh({ exitCode: 0, stdout: JSON.stringify({ required_status_checks: { contexts: [] }, enforce_admins: { enabled: false } }) });
    const a = await protectionAdvice({ ...repo, checks: ["quality"], run });
    expect(a).toMatchObject({ status: "missing", missing: ["quality"] });
    expect(a.command).toBe("gh api -X POST repos/acme/app/branches/main/protection/required_status_checks/contexts -f 'contexts[]=quality' && gh api -X POST repos/acme/app/branches/main/protection/enforce_admins");
  });

  const protection = (statusChecks) => gh({ exitCode: 0, stdout: JSON.stringify({ required_pull_request_reviews: { required_approving_review_count: 1 }, ...(statusChecks ? { required_status_checks: statusChecks } : {}) }) });

  it("missing checks get the additive command, keeping the ones the user has", async () => {
    const a = await protectionAdvice({ ...repo, checks: ["policy-check", "quality"], run: protection({ contexts: ["policy-check", "user-ci"] }) });
    expect(a).toMatchObject({ status: "missing", missing: ["quality"] });
    expect(a.command).toBe("gh api -X POST repos/acme/app/branches/main/protection/required_status_checks/contexts -f 'contexts[]=quality'");
  });

  it("protection without status checks gets the settings page, never a PUT that would wipe its reviews", async () => {
    const a = await protectionAdvice({ ...repo, checks: ["quality"], run: protection(null) });
    expect(a).toMatchObject({ status: "no-checks", settings: "https://github.com/acme/app/settings/branches", missing: ["quality"] });
    expect(a.command).toBeUndefined();
  });

  it("a base branch with a slash is one encoded path segment", async () => {
    const seen = [];
    const a = await protectionAdvice({ owner: "acme", repo: "app", branch: "release/1.0", checks: ["quality"], run: async (cmd, args) => { seen.push(args[1]); return { exitCode: 1, stdout: "", stderr: "HTTP 404" }; } });
    expect(seen[0]).toBe("repos/acme/app/branches/release%2F1.0/protection");
    expect(a.command).toMatch(/branches\/release%2F1\.0\/protection /);
  });

  it("every check already required: nothing to do", async () => {
    const a = await protectionAdvice({ ...repo, checks: ["policy-check"], run: protection({ contexts: ["policy-check"] }) });
    expect(a).toEqual({ status: "ok" });
  });

  it("gh cannot answer: it says it could not verify and points to the settings, never failing", async () => {
    const a = await protectionAdvice({ ...repo, checks: ["policy-check"], run: async () => { throw new Error("spawn gh ENOENT"); } });
    expect(a).toMatchObject({ status: "unverified", settings: "https://github.com/acme/app/settings/branches" });
    expect(a.reason).toMatch(/ENOENT/);
    expect(a.command).toBeUndefined();
  });
});
