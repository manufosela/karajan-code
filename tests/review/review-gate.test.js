// ENV-B1 (KJC-TSK-0637): the gate command wires raw git diffs to the
// cross-AI runner and to verdict verification, with hook-friendly exit codes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { reviewGateCommand } from "../../src/commands/review-gate.js";
import { saveVerdict } from "../../src/review/verdict-store.js";

let dir, cwd0, exit0;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gate-"));
  cwd0 = process.cwd();
  exit0 = process.exitCode;
  process.chdir(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.js"), "const x = 1;\n");
  execFileSync("git", ["add", "a.js"], { cwd: dir });
});
afterEach(() => {
  process.chdir(cwd0);
  process.exitCode = exit0;
  fs.rmSync(dir, { recursive: true, force: true });
});

const config = { projectDir: null, roles: { reviewer: { provider: "codex" } } };

describe("kj review gate", () => {
  it("--check fails with exit 1 when the staged diff has no verdict", async () => {
    const res = await reviewGateCommand({ config, flags: { check: true } });
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("--check passes with exit 0 when an approved verdict matches the staged diff", async () => {
    const staged = execFileSync("git", ["diff", "--cached"], { cwd: dir, encoding: "utf8" });
    // KJC-TSK-0838: a verdict for code carries the proof that sonar covered it.
    await saveVerdict(dir, staged, { verdict: "approved", reviewer: "codex", issues: [], sonar: { ran: true, covered: ["a.js"], uncovered: [] } });
    const res = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
    expect(res.ok).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  // KJC-TSK-0705 (PV-B) — the privacy gate: a staged diff ADDING a denylist
  // datum never becomes a commit; generic PII only warns.
  describe("privacy gate", () => {
    let cfgFile;
    beforeEach(() => {
      cfgFile = path.join(dir, "privacy.yml");
      fs.writeFileSync(cfgFile, 'personal:\n  - "secreto.real@example.com"\n');
      process.env.KJ_PRIVACY_CONFIG = cfgFile;
    });
    afterEach(() => { delete process.env.KJ_PRIVACY_CONFIG; delete process.env.KJ_ALLOW_PII; });

    it("rejects when the staged diff adds a denylist datum — masked, never echoed", async () => {
      fs.writeFileSync(path.join(dir, "a.js"), "const mail = 'secreto.real@example.com';\n");
      execFileSync("git", ["add", "a.js"], { cwd: dir });
      const res = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
      expect(res.verdict).toBe("rejected");
      expect(res.reviewer).toBe("privacy");
      expect(JSON.stringify(res)).not.toContain("secreto.real@example.com");
      expect(process.exitCode).toBe(1);
    });

    it("KJ_ALLOW_PII=1 is the named escape; generic PII alone only warns", async () => {
      process.env.KJ_ALLOW_PII = "1";
      const res = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
      expect(res.reviewer).not.toBe("privacy"); // falls through to the verdict check
      delete process.env.KJ_ALLOW_PII;
      fs.writeFileSync(path.join(dir, "a.js"), "const mail = 'generico@dominio.com';\n");
      execFileSync("git", ["add", "a.js"], { cwd: dir });
      const generic = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
      expect(generic.reviewer).not.toBe("privacy"); // warn, not reject
    });
  });

  // KJC-BUG-0132 (issue #1344): a PURE merge stages nothing of its own —
  // everything it brings reached the parent branches reviewed. Demanding a
  // verdict of an empty diff deadlocks the merge.
  // KJC-TSK-0838: the pre-commit check reads the sonar block the verdict
  // carries — a reviewed diff with code that Sonar never analysed does not enter.
  it("--check refuses an approved verdict whose sonar block says the analysis did not run", async () => {
    const staged = execFileSync("git", ["diff", "--cached"], { cwd: dir, encoding: "utf8" });
    await saveVerdict(dir, staged, { verdict: "approved", reviewer: "codex", issues: [], sonar: { ran: false, reason: "disabled in config" } });
    const res = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Sonar is mandatory for code/);
    expect(process.exitCode).toBe(1);
  });

  it("--check lets that same verdict through only under a live human grant on the rule", async () => {
    const staged = execFileSync("git", ["diff", "--cached"], { cwd: dir, encoding: "utf8" });
    await saveVerdict(dir, staged, { verdict: "approved", reviewer: "codex", issues: [], sonar: { ran: false, reason: "disabled in config" } });
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "policy-exceptions.jsonl"), JSON.stringify({
      rule_id: "method.sonar.code", scopeKind: "permanente", expiresAt: "2999-01-01T00:00:00Z", justification: "laptop sin docker", who: { git: "human" },
    }) + "\n");
    const res = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
    expect(res.ok).toBe(true);
  });

  it("--check refuses a pipeline verdict without a sonar block or whose stage did not run, and lets one whose stage ran through", async () => {
    const staged = execFileSync("git", ["diff", "--cached"], { cwd: dir, encoding: "utf8" });
    await saveVerdict(dir, staged, { verdict: "approved", reviewer: "codex", host: "kj-pipeline", issues: [] });
    const noBlock = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
    expect(noBlock.ok).toBe(false);
    expect(noBlock.reason).toMatch(/no sonar block/);
    await saveVerdict(dir, staged, { verdict: "approved", reviewer: "codex", host: "kj-pipeline", issues: [], sonar: { ran: false, source: "pipeline", reason: "no git remote" } });
    const refused = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/no git remote/);
    await saveVerdict(dir, staged, { verdict: "approved", reviewer: "codex", host: "kj-pipeline", issues: [], sonar: { ran: true, source: "pipeline", projectKey: "k", gateStatus: "OK", covered: [], uncovered: [] } });
    const passed = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
    expect(passed.ok).toBe(true);
  });

  it("--check passes a pure merge commit (MERGE_HEAD present, empty staged diff)", async () => {
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], { cwd: dir });
    fs.writeFileSync(path.join(dir, ".git", "MERGE_HEAD"), "deadbeef\n");
    const res = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
    expect(res.ok).toBe(true);
    expect(res.merge).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it("--check still demands a verdict when the merge stages conflict resolutions", async () => {
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], { cwd: dir });
    fs.writeFileSync(path.join(dir, ".git", "MERGE_HEAD"), "deadbeef\n");
    fs.writeFileSync(path.join(dir, "a.js"), "const x = 3; // resolved\n");
    execFileSync("git", ["add", "a.js"], { cwd: dir });
    const res = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("--check detects a stale verdict after the staged content changes", async () => {
    const staged = execFileSync("git", ["diff", "--cached"], { cwd: dir, encoding: "utf8" });
    await saveVerdict(dir, staged, { verdict: "approved", reviewer: "codex", issues: [] });
    fs.writeFileSync(path.join(dir, "a.js"), "const x = 2;\n");
    execFileSync("git", ["add", "a.js"], { cwd: dir });
    const res = await reviewGateCommand({ config: { ...config, projectDir: dir }, flags: { check: true } });
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
