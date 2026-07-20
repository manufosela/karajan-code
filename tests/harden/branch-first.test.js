// KJC-TSK-0648: branch-first in both layers. The playbook must ORDER it
// (a host following instructions to the letter committed the v4 contract
// on local main — first external session, 2026-07-20), and the pre-commit
// must ENFORCE it: commits on the base branch are rejected unless the
// explicit escape hatch is set.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { renderPlaybook } from "../../src/environment/playbook.js";
import { hookBody, SHEBANG } from "../../src/harden/hook-templates.js";

describe("playbook orders branch-first", () => {
  it("contains an explicit branch-first step", () => {
    const text = renderPlaybook({});
    expect(text).toMatch(/Branch first/i);
    expect(text).toMatch(/never commit on the base branch/i);
  });
});

describe("pre-commit base-branch guard (real sh + git)", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-bf-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
    const hooksDir = path.join(dir, ".karajan", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    // Guard block only — it is emitted first, so slice up to the lint
    // section (a line filter would orphan `fi`s from later blocks).
    const all = hookBody("pre-commit", {}, { baseBranch: "main" }).split("\n");
    const guard = all.slice(0, all.findIndex((l) => l.startsWith("# Lint")));
    fs.writeFileSync(path.join(hooksDir, "pre-commit"), `${SHEBANG}\n${guard.join("\n")}\n`, { mode: 0o755 });
    execFileSync("git", ["config", "core.hooksPath", ".karajan/hooks"], { cwd: dir });
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function tryCommit(msg, env = {}) {
    fs.writeFileSync(path.join(dir, "f.js"), `// ${msg}\n`);
    execFileSync("git", ["add", "f.js"], { cwd: dir });
    return spawnSync("git", ["commit", "-m", msg], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
  }

  it("rejects a commit on the base branch with an actionable message", () => {
    const res = tryCommit("feat: on main");
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/create a branch/i);
  });

  it("KJ_ALLOW_BASE_COMMIT=1 lets the commit through (explicit escape hatch)", () => {
    const res = tryCommit("feat: release on main", { KJ_ALLOW_BASE_COMMIT: "1" });
    expect(res.status).toBe(0);
  });

  it("does not act on a feature branch", () => {
    execFileSync("git", ["checkout", "-q", "-b", "feat/x"], { cwd: dir });
    const res = tryCommit("feat: on branch");
    expect(res.status).toBe(0);
  });

  it("no baseBranch option → no guard block generated", () => {
    expect(hookBody("pre-commit", {})).not.toMatch(/KJ_ALLOW_BASE_COMMIT/);
  });
});
