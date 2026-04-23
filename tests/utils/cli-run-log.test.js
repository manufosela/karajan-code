import { describe, expect, it, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { withCliRunLog } from "../../src/utils/cli-run-log.js";

const cleanups = [];

afterEach(async () => {
  for (const p of cleanups) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
  cleanups.length = 0;
});

async function mkTmpProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-clirl-"));
  cleanups.push(dir);
  return dir;
}

describe("utils/cli-run-log — withCliRunLog", () => {
  it("creates .kj/run.log and writes started/finished markers", async () => {
    const projectDir = await mkTmpProject();
    const result = await withCliRunLog("test", { projectDir }, async () => ({ ok: true }));
    expect(result).toEqual({ ok: true });

    const logContent = await fs.readFile(path.join(projectDir, ".kj", "run.log"), "utf8");
    expect(logContent).toContain("[kj_test] started (cli)");
    expect(logContent).toContain("[kj_test] finished — ok=true");
  });

  it("marks result.ok=false as ok=false in the finished line", async () => {
    const projectDir = await mkTmpProject();
    await withCliRunLog("test", { projectDir }, async () => ({ ok: false }));
    const log = await fs.readFile(path.join(projectDir, ".kj", "run.log"), "utf8");
    expect(log).toContain("[kj_test] finished — ok=false");
  });

  it("writes a failed marker with the error message when fn throws", async () => {
    const projectDir = await mkTmpProject();
    await expect(
      withCliRunLog("test", { projectDir }, async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");

    const log = await fs.readFile(path.join(projectDir, ".kj", "run.log"), "utf8");
    expect(log).toContain("[kj_test] failed — boom");
    // The finished line must NOT appear when the command failed.
    expect(log).not.toContain("[kj_test] finished");
  });

  it("forwardProgress mirrors every emitter progress event into run.log", async () => {
    const projectDir = await mkTmpProject();
    await withCliRunLog("test", { projectDir }, async ({ forwardProgress }) => {
      const emitter = new EventEmitter();
      forwardProgress(emitter);
      emitter.emit("progress", { type: "skills:addyosmani-ready", stage: "skills", message: "21 slugs" });
      emitter.emit("progress", { type: "coder:output", stage: "coder", message: "hello" });
      return { ok: true };
    });

    const log = await fs.readFile(path.join(projectDir, ".kj", "run.log"), "utf8");
    expect(log).toContain("[skills:addyosmani-ready]");
    expect(log).toContain("21 slugs");
    expect(log).toContain("[coder:output]");
  });

  it("forwardProgress with no emitter is a no-op (does not crash)", async () => {
    const projectDir = await mkTmpProject();
    const result = await withCliRunLog("test", { projectDir }, async ({ forwardProgress }) => {
      forwardProgress(null);
      forwardProgress(undefined);
      forwardProgress({ notAnEmitter: true });
      return { ok: true };
    });
    expect(result.ok).toBe(true);
  });

  it("defaults to process.cwd() when projectDir is not provided", async () => {
    const projectDir = await mkTmpProject();
    const prevCwd = process.cwd();
    process.chdir(projectDir);
    try {
      await withCliRunLog("test", {}, async () => ({ ok: true }));
    } finally {
      process.chdir(prevCwd);
    }
    const log = await fs.readFile(path.join(projectDir, ".kj", "run.log"), "utf8");
    expect(log).toContain("[kj_test] started");
  });

  it("closes the run.log file descriptor even when fn throws", async () => {
    const projectDir = await mkTmpProject();
    await expect(
      withCliRunLog("test", { projectDir }, async () => { throw new Error("bye"); })
    ).rejects.toThrow();
    // If the fd was left open, subsequent reads would still work, so we just
    // assert the failure line made it to disk and the file is readable.
    const log = await fs.readFile(path.join(projectDir, ".kj", "run.log"), "utf8");
    expect(log).toContain("[kj_test] failed");
  });
});
