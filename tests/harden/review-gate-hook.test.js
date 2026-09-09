// ENV-C1 (KJC-TSK-0638): the pre-commit hook enforces the cross-AI review
// gate — but ONLY when the project opts in via the .karajan/review-gate
// marker. The e2e test runs the real generated hook under sh against a
// real git repo: no marker → commit passes; marker + no verdict → commit
// rejected; marker + matching approved verdict → commit passes.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { hookBody, SHEBANG } from "../../src/harden/hook-templates.js";
import { saveVerdict } from "../../src/review/verdict-store.js";

describe("pre-commit template includes the opt-in review gate", () => {
  it("guards on the COMMITTED .karajan/review-gate marker and calls kj review --check", () => {
    const body = hookBody("pre-commit", {});
    expect(body).toMatch(/\.karajan\/review-gate/);
    expect(body).toMatch(/kj review --check/);
    expect(body).toMatch(/kj review --staged/); // actionable message
    // KJC-BUG-0165: the gate keys on the marker being COMMITTED (HEAD), not
    // merely present — so the bootstrap commit that introduces it is exempt.
    expect(body).toMatch(/cat-file -e HEAD:\.karajan\/review-gate/);
  });
});

describe("review gate e2e (real sh + git)", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  let dir, env;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gate-e2e-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
    const hooksDir = path.join(dir, ".karajan", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    // Only the gate block: isolate the behavior under test from lint/format.
    const gateBlock = hookBody("pre-commit", {}).split("\n")
      .filter((l) => !l.includes("lint") && !l.includes("format"));
    fs.writeFileSync(path.join(hooksDir, "pre-commit"), `${SHEBANG}\n${gateBlock.join("\n")}\n`, { mode: 0o755 });
    execFileSync("git", ["config", "core.hooksPath", ".karajan/hooks"], { cwd: dir });
    // CI has no global kj install: shim `kj` onto this repo's bin, with an
    // isolated KARAJAN_HOME so the maintainer's real config never leaks in.
    const shimDir = path.join(dir, "bin-shim");
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(path.join(shimDir, "kj"),
      `${SHEBANG}\nexec node "${path.join(repoRoot, "bin", "kj.js")}" "$@"\n`, { mode: 0o755 });
    env = { ...process.env, PATH: `${shimDir}:${process.env.PATH}`, KARAJAN_HOME: path.join(dir, "kj-home") };
    delete env.CLAUDECODE;
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function tryCommit(msg) {
    fs.writeFileSync(path.join(dir, "f.js"), `// ${msg}\n`);
    execFileSync("git", ["add", "f.js"], { cwd: dir });
    return spawnSync("git", ["commit", "-m", msg], { cwd: dir, encoding: "utf8", env });
  }

  // Commit the marker the way the bootstrap does: it is exempt (not yet in
  // HEAD), so this must pass with NO verdict — the KJC-BUG-0165 fix.
  function commitMarker() {
    fs.writeFileSync(path.join(dir, ".karajan", "review-gate"), "");
    execFileSync("git", ["add", ".karajan/review-gate"], { cwd: dir });
    return spawnSync("git", ["commit", "-m", "chore: install review gate"], { cwd: dir, encoding: "utf8", env });
  }

  it("no marker → commit passes (opt-in only)", () => {
    const res = tryCommit("feat: no gate");
    expect(res.status).toBe(0);
  });

  it("bootstrap: the commit that INTRODUCES the marker is exempt — no verdict needed (KJC-BUG-0165)", () => {
    const res = commitMarker();
    expect(`${res.stdout}${res.stderr}`).not.toMatch(/kj review --staged/);
    expect(res.status).toBe(0);
  });

  it("marker COMMITTED + no verdict → next commit rejected with actionable message", () => {
    expect(commitMarker().status).toBe(0);
    const res = tryCommit("feat: gated");
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/kj review --staged/);
  });

  it("marker COMMITTED + deleting the working-tree file does NOT bypass the gate", () => {
    expect(commitMarker().status).toBe(0);
    fs.rmSync(path.join(dir, ".karajan", "review-gate"));
    const res = tryCommit("feat: try to bypass");
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/kj review --staged/);
  });

  it("marker COMMITTED + approved verdict matching the staged diff → commit passes", async () => {
    expect(commitMarker().status).toBe(0);
    fs.writeFileSync(path.join(dir, "f.js"), "// approved change\n");
    execFileSync("git", ["add", "f.js"], { cwd: dir });
    const staged = execFileSync("git", ["diff", "--cached"], { cwd: dir, encoding: "utf8" });
    await saveVerdict(dir, staged, { verdict: "approved", reviewer: "codex", issues: [] });
    const res = spawnSync("git", ["commit", "-m", "feat: approved change"], { cwd: dir, encoding: "utf8", env });
    expect(`${res.stdout}${res.stderr}`).not.toMatch(/kj review --staged/);
    expect(res.status).toBe(0);
  });
});
