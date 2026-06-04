import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  restoreFiles,
  stashFilesAside,
  withStashedFiles,
} from "../../src/review/git-stash-helper.js";

function makeRunner({ trackedFiles = new Set() } = {}) {
  let marker = null;
  const fn = vi.fn(async (_cmd, args) => {
    const [sub, sub2] = args;
    if (sub === "ls-files" && args.includes("--error-unmatch")) {
      const file = args[args.length - 1];
      return { exitCode: trackedFiles.has(file) ? 0 : 1, stdout: "", stderr: "" };
    }
    if (sub === "stash" && sub2 === "push") {
      marker = args[args.indexOf("-m") + 1];
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (sub === "stash" && sub2 === "list") {
      return { exitCode: 0, stdout: `stash@{0}: ${marker || ""}\n`, stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  return fn;
}

describe("git-stash-helper", () => {
  let projectDir;
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "kj-stash-test-"));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("no-ops on empty file list", async () => {
    const runner = makeRunner();
    const token = await stashFilesAside([], { projectDir, runner });
    expect(token).toMatchObject({ trackedStashRef: null, untrackedMoves: [], marker: null });
    expect(runner).not.toHaveBeenCalled();
  });

  it("moves untracked files aside and restores them", async () => {
    await writeFile(join(projectDir, "u.js"), "hello");
    const runner = makeRunner();
    const token = await stashFilesAside(["u.js"], { projectDir, runner });
    expect(existsSync(join(projectDir, "u.js"))).toBe(false);
    expect(token.untrackedMoves).toHaveLength(1);
    await restoreFiles(token, { projectDir, runner });
    expect(await readFile(join(projectDir, "u.js"), "utf8")).toBe("hello");
  });

  it("stashes tracked files via git stash push and pops on restore", async () => {
    const runner = makeRunner({ trackedFiles: new Set(["t.js"]) });
    const token = await stashFilesAside(["t.js"], { projectDir, runner });
    expect(token.trackedStashRef).toBe("stash@{0}");
    await restoreFiles(token, { projectDir, runner });
    expect(runner).toHaveBeenCalledWith("git", ["stash", "pop", "stash@{0}"], { cwd: projectDir });
  });

  it("throws when git stash push fails", async () => {
    const runner = vi.fn(async (_cmd, args) => {
      if (args[0] === "ls-files") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[0] === "stash" && args[1] === "push") {
        return { exitCode: 1, stdout: "", stderr: "boom" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    await expect(stashFilesAside(["t.js"], { projectDir, runner })).rejects.toThrow(/boom/);
  });

  it("withStashedFiles restores even when body throws", async () => {
    await writeFile(join(projectDir, "u.js"), "x");
    const runner = makeRunner();
    await expect(
      withStashedFiles(["u.js"], async () => { throw new Error("body"); }, { projectDir, runner })
    ).rejects.toThrow(/body/);
    expect(existsSync(join(projectDir, "u.js"))).toBe(true);
  });

  it("restoreFiles is idempotent for already-empty tokens", async () => {
    const token = { trackedStashRef: null, untrackedMoves: [] };
    await expect(restoreFiles(token, { projectDir, runner: makeRunner() })).resolves.toBeUndefined();
  });
});
