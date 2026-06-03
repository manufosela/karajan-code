import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { collectRepoCandidates } from "../../src/utils/repo-cleaner.js";

const DAY = 24 * 60 * 60 * 1000;

async function git(cwd, args) {
  await execa("git", args, { cwd });
}

async function initRepo(cwd) {
  await git(cwd, ["init", "-q", "-b", "main"]);
  await git(cwd, ["config", "user.email", "t@t.local"]);
  await git(cwd, ["config", "user.name", "t"]);
  await git(cwd, ["config", "commit.gpgsign", "false"]);
  await fs.writeFile(path.join(cwd, "README.md"), "# x\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-q", "-m", "init"]);
}

describe("repo-cleaner", () => {
  let cwd;
  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "repo-cleaner-"));
    await initRepo(cwd);
  });
  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("returns empty when nothing stale", async () => {
    const { candidates, errors } = await collectRepoCandidates({ cwd, maxAgeDays: 7, mergedTo: "main" });
    expect(candidates).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("detects stale dist/ and *.tmp older than threshold", async () => {
    await fs.mkdir(path.join(cwd, "dist"), { recursive: true });
    await fs.writeFile(path.join(cwd, "dist", "bundle.js"), "x");
    await fs.writeFile(path.join(cwd, "old.tmp"), "x");
    const past = (Date.now() - 30 * DAY) / 1000;
    await fs.utimes(path.join(cwd, "dist"), past, past);
    await fs.utimes(path.join(cwd, "old.tmp"), past, past);
    const { candidates } = await collectRepoCandidates({ cwd, maxAgeDays: 7, mergedTo: "main" });
    const kinds = candidates.map((c) => c.kind).sort();
    expect(kinds).toContain("dir");
    expect(kinds).toContain("file");
    const dist = candidates.find((c) => c.target.endsWith("/dist"));
    expect(dist.command).toMatch(/^rm -rf /);
  });

  it("ignores recent dist/", async () => {
    await fs.mkdir(path.join(cwd, "dist"), { recursive: true });
    await fs.writeFile(path.join(cwd, "dist", "bundle.js"), "x");
    const { candidates } = await collectRepoCandidates({ cwd, maxAgeDays: 7, mergedTo: "main" });
    expect(candidates.find((c) => c.target.endsWith("/dist"))).toBeUndefined();
  });

  it("detects branches merged into base ref", async () => {
    await git(cwd, ["checkout", "-q", "-b", "feat/x"]);
    await fs.writeFile(path.join(cwd, "f.txt"), "y");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-q", "-m", "feat"]);
    await git(cwd, ["checkout", "-q", "main"]);
    await git(cwd, ["merge", "-q", "--no-ff", "feat/x", "-m", "merge"]);
    const { candidates } = await collectRepoCandidates({ cwd, maxAgeDays: 365, mergedTo: "main" });
    const branch = candidates.find((c) => c.kind === "branch" && c.target === "feat/x");
    expect(branch).toBeDefined();
    expect(branch.command).toBe("git branch -d feat/x");
  });
});
