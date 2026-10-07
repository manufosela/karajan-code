import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hardenCommand, resolveCmds } from "../../src/commands/harden.js";

let repo;
const logger = { info: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  repo = mkdtempSync(join(tmpdir(), "kj-harden-cmd-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("resolveCmds", () => {
  it("derives commands from package.json scripts", async () => {
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", "format:check": "prettier -c .", test: "vitest run" } })
    );
    expect(await resolveCmds(repo)).toEqual({
      lint: "npm run -s lint",
      format: "npm run -s format:check",
      test: "npm test",
    });
  });

  it("falls back to framework detection when no test script", async () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ devDependencies: { vitest: "^4" } }));
    expect((await resolveCmds(repo)).test).toBe("npx vitest run");
  });
});

describe("hardenCommand", () => {
  // KJC-BUG-0289 (#1984): what kj harden generates, kj commits (KJC-BUG-0273's
  // path), never what was dirty before and never on the base branch. Left to the
  // agent, 3.2k generated lines exceeded its own PR size and stayed untracked.
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const withHistory = () => {
    git("config", "user.email", "t@t");
    git("config", "user.name", "T");
    writeFileSync(join(repo, "README.md"), "hi\n");
    git("add", "README.md");
    git("commit", "-qm", "chore: first");
    git("branch", "-M", "main"); // CI's init.defaultBranch may differ; the base branch kj resolves is main
  };

  it("commits the contract it generated on a branch, leaving what was dirty before (KJC-BUG-0289)", async () => {
    withHistory();
    git("checkout", "-qb", "chore/kj");
    writeFileSync(join(repo, "CLAUDE.md"), "# mine, edited before kj ran\n");
    const res = await hardenCommand({ projectDir: repo, profile: "standard", ci: false, guidelines: false, logger });
    expect(res.ok).toBe(true);
    expect(res.contract.committed).toBe(true);
    expect(git("log", "-1", "--format=%s")).toMatch(/^chore\(kj\)/);
    const files = git("show", "--name-only", "--format=", "HEAD").trim().split("\n");
    expect(files).toContain(".karajan/hooks/pre-commit");
    expect(files).toContain(".editorconfig");
    expect(files).not.toContain("CLAUDE.md");
    expect(git("status", "--porcelain", "--", "CLAUDE.md").trim()).toBe("?? CLAUDE.md");
  });

  it("on the base branch it commits nothing and says where the commit belongs", async () => {
    withHistory();
    const res = await hardenCommand({ projectDir: repo, profile: "minimal", logger });
    expect(res.ok).toBe(true);
    expect(res.contract.committed).toBe(false);
    expect(res.contract.reason).toMatch(/base branch/);
    expect(git("log", "-1", "--format=%s")).toBe("chore: first\n");
  });

  it("installs hooks and reports ok", async () => {
    const res = await hardenCommand({ projectDir: repo, profile: "standard", logger });
    expect(res.ok).toBe(true);
    expect(res.hooks).toHaveLength(5);
    expect(existsSync(join(repo, ".karajan", "hooks", "commit-msg"))).toBe(true);
    expect(logger.info).toHaveBeenCalled();
  });

  it("dry-run writes nothing and emits JSON when asked", async () => {
    const res = await hardenCommand({ projectDir: repo, profile: "minimal", dryRun: true, json: true, logger });
    expect(res.ok).toBe(true);
    expect(existsSync(join(repo, ".karajan", "hooks", "commit-msg"))).toBe(false);
    const payload = JSON.parse(logger.info.mock.calls.at(-1)[0]);
    expect(payload).toMatchObject({ ok: true, profile: "minimal", dryRun: true });
  });

  const seedPythonWrapper = () => {
    mkdirSync(join(repo, "wrappers", "python"), { recursive: true });
    writeFileSync(join(repo, "wrappers", "python", "pyproject.toml"), "");
  };

  it("honours kj.harden.exclude from package.json (KJC-TSK-0564)", async () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ kj: { harden: { exclude: ["wrappers"] } } }));
    seedPythonWrapper();
    const res = await hardenCommand({ projectDir: repo, profile: "standard", json: true, logger });
    expect(res.ok).toBe(true);
    expect(res.configs.some((c) => c.file.includes("wrappers"))).toBe(false);
  });

  it("--exclude flag skips a language root (KJC-TSK-0564)", async () => {
    writeFileSync(join(repo, "package.json"), "{}");
    seedPythonWrapper();
    const res = await hardenCommand({ projectDir: repo, exclude: ["wrappers"], json: true, logger });
    expect(res.configs.some((c) => c.file.includes("wrappers"))).toBe(false);
  });

  it("--report is read-only and emits the advisory (KJC-TSK-0566)", async () => {
    writeFileSync(join(repo, "package.json"), "{}");
    const res = await hardenCommand({ projectDir: repo, report: true, logger });
    expect(res).toMatchObject({ ok: true, report: true });
    expect(Array.isArray(res.artifacts)).toBe(true);
    expect(existsSync(join(repo, ".karajan", "hooks", "commit-msg"))).toBe(false);
    expect(logger.info.mock.calls.flat().join("\n")).toContain("advisory report");
  });

  it("--report --json emits the structured comparison", async () => {
    writeFileSync(join(repo, "package.json"), "{}");
    await hardenCommand({ projectDir: repo, report: true, json: true, logger });
    const payload = JSON.parse(logger.info.mock.calls.at(-1)[0]);
    expect(Array.isArray(payload.artifacts)).toBe(true);
  });

  it("--interactive without a TTY falls back to a normal install (KJC-TSK-0567)", async () => {
    // vitest has no TTY, so the interactive branch is skipped and seed-if-absent runs.
    const res = await hardenCommand({ projectDir: repo, interactive: true, logger });
    expect(res.ok).toBe(true);
    expect(existsSync(join(repo, ".karajan", "hooks", "commit-msg"))).toBe(true);
  });

  it("returns ok:false on a non-repo dir without throwing", async () => {
    const plain = mkdtempSync(join(tmpdir(), "kj-plain-"));
    const res = await hardenCommand({ projectDir: plain, logger });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Not a git repository/);
    rmSync(plain, { recursive: true, force: true });
  });
});
