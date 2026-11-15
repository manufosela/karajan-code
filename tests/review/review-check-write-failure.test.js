// HU-4338: --check says the real cause when it cannot write; only a missing verdict says one is missing.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { reviewGateCommand, describeCheckFailure } from "../../src/commands/review-gate.js";
import { hookBody } from "../../src/harden/hook-templates.js";
import { saveVerdict } from "../../src/review/verdict-store.js";
import { fakeKjPath } from "../harden/_fake-kj.js";

let dir, cwd0, exit0, out, err;
const NO_VERDICT = /no approved cross-AI verdict/;
const said = (spy) => spy.mock.calls.flat().join("\n");
const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir });
const writePkg = (v) => fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "app", version: v })}\n`);
const check = (prefixes) => reviewGateCommand({
  config: { projectDir: dir, roles: { reviewer: { provider: "codex" } }, method_gates: { review_exempt_branches: prefixes } },
  flags: { check: true },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-check-write-"));
  cwd0 = process.cwd();
  exit0 = process.exitCode;
  process.chdir(dir);
  git("init", "-q", "-b", "main", "--template=");
  writePkg("1.0.0");
  git("add", "package.json");
  git("commit", "-qm", "base");
  git("switch", "-qc", "chore/release-1.1.0");
  writePkg("1.1.0");
  git("add", "package.json");
  out = vi.spyOn(console, "log").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.chdir(cwd0);
  process.exitCode = exit0;
  vi.restoreAllMocks();
  delete process.env.KJ_PRIVACY_CONFIG;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("kj review --check says why it refuses", () => {
  it("exits 2 with the cause, claiming neither a pass nor a missing verdict, when the decision log cannot be written", async () => {
    fs.mkdirSync(path.join(dir, ".karajan", "policy-decisions.jsonl"), { recursive: true });
    const res = await check(["chore/release-"]);
    expect(process.exitCode).toBe(2);
    expect(said(err)).toMatch(/policy-decisions\.jsonl.*EISDIR|EISDIR.*policy-decisions\.jsonl/);
    expect(res).toEqual({ ok: false, reason: said(err) });
    expect(said(out)).not.toMatch(/gate passes/);
    expect(said(out)).not.toMatch(NO_VERDICT);
  });

  it("exits 1 and says the verdict is missing when there is simply no verdict", async () => {
    await check(["hotfix/"]);
    expect(process.exitCode).toBe(1);
    expect(said(out)).toMatch(NO_VERDICT);
  });

  it("exits 1 with the rejection, not a missing verdict, when the recorded verdict was rejected", async () => {
    await saveVerdict(dir, String(git("diff", "--cached")), { verdict: "rejected", reviewer: "codex", issues: [] });
    await check([]);
    expect(process.exitCode).toBe(1);
    expect(said(out)).toMatch(/rejected by codex/);
    expect(said(out)).not.toMatch(NO_VERDICT);
  });

  it("exits 1 with the gate's own reason, not a missing verdict, when another gate refuses", async () => {
    fs.writeFileSync(path.join(dir, "privacy.yml"), 'personal:\n  - "secreto.real@example.com"\n');
    process.env.KJ_PRIVACY_CONFIG = path.join(dir, "privacy.yml");
    fs.writeFileSync(path.join(dir, "notes.txt"), "secreto.real@example.com\n");
    git("add", "notes.txt");
    await check([]);
    expect(process.exitCode).toBe(1);
    expect(said(out)).toMatch(/privacy gate/);
    expect(said(out)).not.toMatch(NO_VERDICT);
  });

  it("says a system error once, with the sandbox hint for EROFS", () => {
    const erofs = Object.assign(new Error("EROFS: read-only file system, open '/r/.karajan/policy-decisions.jsonl'"), { code: "EROFS", syscall: "open", path: "/r/.karajan/policy-decisions.jsonl" });
    expect(describeCheckFailure(erofs)).toBe("kj: review --check could not finish: EROFS: read-only file system, open '/r/.karajan/policy-decisions.jsonl' (a sandboxed shell? commit from your own terminal or turn the sandbox off for this command)");
  });

  it("names the code a message leaves out; the sandbox hint is for EROFS and EACCES only", () => {
    expect(describeCheckFailure(Object.assign(new Error("EACCES: permission denied, open '/r/x'"), { code: "EACCES" }))).toMatch(/sandboxed shell/);
    expect(describeCheckFailure(Object.assign(new Error("git diff failed"), { code: "ENOENT" }))).toBe("kj: review --check could not finish: ENOENT: git diff failed");
    expect(describeCheckFailure("boom")).toBe("kj: review --check could not finish: boom");
  });

  it("leaves the other modes as they were: a failure outside --check still throws", async () => {
    await expect(reviewGateCommand({ config: { projectDir: dir }, flags: { range: "no-such-ref..HEAD" } })).rejects.toThrow(/no-such-ref/);
  });
});

describe("the commit hook", () => {
  it.each([1, 2])("stops with kj's exit code %i and adds no cause of its own", (code) => {
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "review-gate"), "on\n");
    git("add", ".karajan/review-gate");
    git("commit", "-q", "--no-verify", "-m", "chore: gate");
    const res = spawnSync("sh", ["-c", hookBody("pre-commit", {})], {
      cwd: dir, encoding: "utf8", env: { PATH: fakeKjPath(dir, { exitCode: code }), HOME: dir, GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    expect(res.status).toBe(code);
    expect(`${res.stdout}${res.stderr}`).not.toMatch(NO_VERDICT);
  });
});
