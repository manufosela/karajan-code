// KJC-TSK-0883 (ADR 0011): el watcher vigilaba ~/.karajan/plans y onboarding
// ENTEROS e indexaba lo de cualquier proyecto con el slug del suyo, en la base
// global, y un solo PID por maquina impedia un watcher por proyecto.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pidFilePath, startWatcher, watchedPaths } from "../../src/rag/watcher.js";

let root, prevHome, prevDb;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-watch-proj-"));
  prevHome = process.env.KARAJAN_HOME; prevDb = process.env.KJ_RAG_DB;
  process.env.KARAJAN_HOME = join(root, "home");
  delete process.env.KJ_RAG_DB;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
  if (prevDb !== undefined) process.env.KJ_RAG_DB = prevDb;
  rmSync(root, { recursive: true, force: true });
});

describe("watcher por proyecto", () => {
  it("vigila solo los planes y el onboarding de SU proyecto", () => {
    const home = process.env.KARAJAN_HOME;
    expect(watchedPaths(join(root, "alpha"))).toEqual([join(home, "onboarding", "alpha.md"), join(home, "plans", "alpha")]);
    expect(watchedPaths(join(root, "alpha"), { withSources: true })).toContain(join(root, "alpha"));
  });

  it("cada proyecto tiene su PID", () => {
    expect(pidFilePath(join(root, "alpha"))).not.toBe(pidFilePath(join(root, "beta")));
    expect(pidFilePath(join(root, "alpha"))).toBe(join(process.env.KARAJAN_HOME, "watchers", "alpha.pid"));
  });

  it("escribe en la base del proyecto, no en la global", async () => {
    const projectDir = join(root, "alpha");
    const stop = startWatcher({ projectDir, config: { rag: { embedder: { dim: 8 } } }, logger: { info() {}, warn() {} } });
    await stop();
    expect(existsSync(join(projectDir, ".karajan", "rag.db"))).toBe(true);
    expect(existsSync(join(process.env.KARAJAN_HOME, "rag.db"))).toBe(false);
  });
});
