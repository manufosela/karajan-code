// HU-4145 (KJC-BUG-0573): kj-verdicts.yml runs on pull_request (the PR's own copy), so the
// protection is the base's kj-policy.yml: `kj policy check --strict` refuses an unsealed change
// to any .github/workflows/* file (defaults.governance.write, not removable by policy.yml).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { policyCommand } from "../../src/commands/policy.js";

const VERDICTS = ".github/workflows/kj-verdicts.yml";
const SECRETS = ".github/workflows/kj-secrets.yml";
let dir;
const cwd0 = process.cwd();
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, stdio: "pipe" });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-tamper-"));
  git("init", "-q", "-b", "main");
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\n");
  fs.writeFileSync(path.join(dir, VERDICTS), "name: v\njobs: {}\n");
  fs.writeFileSync(path.join(dir, SECRETS), "name: s\njobs: {}\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "pr");
  process.chdir(dir);
});
afterEach(() => { process.chdir(cwd0); fs.rmSync(dir, { recursive: true, force: true }); });

const checkRange = async () => {
  const out = [];
  const log = (m) => out.push(m);
  const code = await policyCommand({
    action: "check", config: { projectDir: dir }, flags: { range: "main...pr", strict: true },
    logger: { info: log, warn: log, error: log },
  });
  return { code, text: out.join("\n") };
};
const commitPr = () => { git("add", "-A"); git("commit", "-q", "-m", "pr"); };

describe("a PR cannot tamper with the workflows and pass kj policy check --strict", () => {
  it.each([
    ["edits kj-verdicts.yml to exit 0", () => fs.writeFileSync(path.join(dir, VERDICTS), "name: v\njobs:\n  j:\n    steps: [{ run: exit 0 }]\n")],
    ["deletes kj-verdicts.yml", () => fs.rmSync(path.join(dir, VERDICTS))],
    ["edits kj-secrets.yml", () => fs.writeFileSync(path.join(dir, SECRETS), "name: s\njobs:\n  j:\n    steps: [{ run: exit 0 }]\n")],
  ])("the PR %s: exit non-zero naming defaults.governance.write", async (_label, tamper) => {
    tamper();
    commitPr();
    const { code, text } = await checkRange();
    expect(code).not.toBe(0);
    expect(text).toContain("defaults.governance.write");
  });
});
