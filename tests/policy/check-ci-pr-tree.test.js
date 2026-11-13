// HU-4150 (KJC-BUG-0575): in CI, kj policy check --range runs inside the PR's
// worktree. What the PR tree carries (.karajan/policy.yml, .gitattributes) must
// not change the verdict on the PR's own added lines.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { policyCommand } from "../../src/commands/policy.js";

let repo;
const git = (...args) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { stdio: "pipe" });
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
const lines = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
const LOC_POLICY = (max) => `version: 1\ninvariants:\n  - { id: loc, kind: diff-threshold, metric: net_lines_added, max: ${max}, enforcement: deny }\n`;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "kj-polpr-"));
  git("init", "-q", "-b", "main");
  write(".karajan/policy.yml", LOC_POLICY(10));
  write("src/a.js", lines(2));
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "pr");
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

const prCommit = () => {
  git("add", "-A");
  git("commit", "-qm", "pr");
};

const check = async () => {
  const out = [];
  const logger = { info: (m) => out.push(m), warn: (m) => out.push(m), error: (m) => out.push(m) };
  const code = await policyCommand({ action: "check", config: { projectDir: repo }, flags: { range: "main...HEAD", strict: true }, logger });
  return { code, text: out.join("\n") };
};

describe("kj policy check --range: the PR tree does not judge itself", () => {
  it("a source file over the budget is denied (baseline)", async () => {
    write("src/big.js", lines(40));
    prCommit();
    const { code, text } = await check();
    expect(code).toBe(2);
    expect(text).toMatch(/\[loc\]/);
  });

  it("raising the budget in the PR's policy.yml is denied as a governance change", async () => {
    write(".karajan/policy.yml", LOC_POLICY(1000));
    write("src/big.js", lines(40));
    prCommit();
    const { code, text } = await check();
    expect(code).toBe(2);
    expect(text).toMatch(/defaults\.governance\.write/);
  });

  it("dropping the rule from the PR's policy.yml is denied as a governance change", async () => {
    write(".karajan/policy.yml", "version: 1\n");
    write("src/big.js", lines(40));
    prCommit();
    const { code, text } = await check();
    expect(code).toBe(2);
    expect(text).toMatch(/defaults\.governance\.write/);
  });

  for (const attr of ["-diff", "binary", "diff=custom"]) {
    it(`a PR .gitattributes marking a source file ${attr} still counts its lines`, async () => {
      write(".gitattributes", `src/big.js ${attr}\n`);
      write("src/big.js", lines(40));
      prCommit();
      const { code, text } = await check();
      expect(code).toBe(2);
      expect(text).toMatch(/\[loc\]/);
    });
  }

  it("the base's own .gitattributes still decide, read from the base tree", async () => {
    git("checkout", "-q", "main");
    write(".gitattributes", "data/*.dat -diff\n");
    prCommit();
    git("checkout", "-q", "pr");
    git("rebase", "-q", "main");
    write("data/table.dat", lines(40));
    prCommit();
    expect((await check()).code).toBe(0);
  });
});
