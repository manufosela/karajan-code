// HU-3812 (issue #3763): on a branch the project declares in
// method_gates.review_exempt_branches, a pure version bump commits without a verdict.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { reviewGateCommand } from "../../src/commands/review-gate.js";

let dir, cwd0, exit0;
const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir });
const writePkg = (pkg) => fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gate-bump-"));
  cwd0 = process.cwd();
  exit0 = process.exitCode;
  process.chdir(dir);
  git("init", "-q", "-b", "main");
  writePkg({ name: "app", version: "1.0.0" });
  git("add", "package.json");
  git("commit", "-qm", "base");
  git("switch", "-qc", "chore/release-1.1.0");
});
afterEach(() => {
  process.chdir(cwd0);
  process.exitCode = exit0;
  fs.rmSync(dir, { recursive: true, force: true });
});

const config = (prefixes) => ({ projectDir: dir, roles: { reviewer: { provider: "codex" } }, method_gates: { review_exempt_branches: prefixes } });
const check = (prefixes) => reviewGateCommand({ config: config(prefixes), flags: { check: true } });
const stageBump = (extra = {}) => {
  writePkg({ name: "app", version: "1.1.0", ...extra });
  git("add", "package.json");
};

describe("kj review --check on a declared release branch", () => {
  it("passes a version bump with a trail", async () => {
    stageBump();
    const res = await check(["chore/release-"]);
    expect(res).toMatchObject({ ok: true, exempt: "release-bump" });
    expect(process.exitCode).toBe(0);
  });

  it("still demands a verdict when the bump carries another change", async () => {
    stageBump({ private: true });
    const res = await check(["chore/release-"]);
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("still demands a verdict for a bump on an undeclared branch", async () => {
    stageBump();
    const res = await check(["hotfix/"]);
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
