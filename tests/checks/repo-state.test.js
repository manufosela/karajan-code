// BOOT-B (KJC-TSK-0858, epic KJC-PCS-0088) — the state of the REPO, which none
// of the other checks looks at. The cold-start map found projects raised outside
// the method and nobody noticed until a gate blocked, with no explanation. Every
// symptom comes out named, with its evidence and the literal command that
// repairs it, and the bootstrap phase is never punished: a repo with no commit
// yet is starting, not broken.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRepoStateCheck } from "../../src/checks/repo-state.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const write = (rel, text = "x\n") => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const detect = () => createRepoStateCheck({ projectDir: dir }).detect({ config: { projectDir: dir } });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-repostate-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const seedMethod = () => {
  write(".karajan/review-gate");
  write(".karajan/hooks/pre-commit", "#!/bin/sh\n");
  write(".karajan/identity.local.yml", "gh_user: t\ngit_email: t@t\n");
};
const seedRepo = () => {
  execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"], { encoding: "utf8" });
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
};

describe("repo-state check", () => {
  it("no repository at all: says so and names git init, or kj bootstrap", async () => {
    const r = await detect();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/sin repositorio/i);
    expect(r.fix).toMatch(/kj bootstrap/);
  });

  it("the bootstrap phase is not a defect: a repo with no commit is starting", async () => {
    seedRepo();
    seedMethod();
    const r = await detect();
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/arranque/i);
  });

  it("the harness written before git exists: it governs nothing, and says exactly that", async () => {
    seedMethod();
    const r = await detect();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/harness/i);
    expect(r.detail).toMatch(/no gobierna nada/);
  });

  it("the gate marker never committed: a clone would inherit nothing", async () => {
    seedRepo();
    seedMethod();
    write("README.md");
    git("add", "README.md");
    git("commit", "-qm", "chore: first");
    const r = await detect();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/contrato no está en git/);
    expect(r.fix).toMatch(/git add/);
  });

  // Caught by codex: `git ls-files` counts a staged file as tracked, but a
  // clone inherits only what is COMMITTED — which is the symptom itself.
  it("staged but never committed still counts as not inherited", async () => {
    seedRepo();
    seedMethod();
    write("README.md");
    git("add", "README.md");
    git("commit", "-qm", "chore: first");
    git("add", ".karajan/review-gate", ".karajan/hooks/pre-commit");
    const r = await detect();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/contrato no está en git/);
  });

  it("no identity declared: the Sentinel will deny every git and gh later", async () => {
    seedRepo();
    write(".karajan/review-gate");
    write(".karajan/hooks/pre-commit", "#!/bin/sh\n");
    git("add", "-A");
    git("commit", "-qm", "chore: contract");
    const r = await detect();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/identidad/i);
    expect(r.fix).toMatch(/kj identity set/);
  });

  it("a healthy project reports nothing", async () => {
    seedRepo();
    seedMethod();
    git("add", "-A");
    git("commit", "-qm", "chore: contract");
    const r = await detect();
    expect(r.ok).toBe(true);
  });
});
