// KJC-BUG-0426 (issue #2670): opening the RAG index without the better-sqlite3 addon
// says how to build it instead of surfacing the raw bindings error.
import { describe, expect, it, vi } from "vitest";

const bindings = new Error("Could not locate the bindings file. Tried:\n → /x/better_sqlite3.node");
vi.mock("../../src/rag/vec-store.js", () => ({
  openVecStore: () => {
    throw bindings;
  },
}));

const { openLibraryStore, openProjectStore } = await import("../../src/rag/project-store.js");
const { emptyIndexRemedy, migrateProjectIndex } = await import("../../src/rag/migrate.js");
const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { tmpdir } = await import("node:os");

describe("project store × unbuilt native addon — KJC-BUG-0426", () => {
  it("openProjectStore explains the missing addon and keeps the cause", () => {
    const err = (() => { try { openProjectStore({ projectDir: "/tmp/kj-none" }); } catch (e) { return e; } return null; })();
    expect(err.message).toMatch(/better-sqlite3 native addon is not built/);
    expect(err.cause).toBe(bindings);
  });

  it("openLibraryStore explains it too", () => {
    expect(() => openLibraryStore()).toThrow(/better-sqlite3 native addon is not built/);
  });

  it("the index migration explains it too", () => {
    const dir = mkdtempSync(join(tmpdir(), "kj-native-migrate-"));
    try {
      const legacyPath = join(dir, "legacy.db");
      writeFileSync(legacyPath, "");
      expect(() => migrateProjectIndex({ slug: "p", legacyPath, targetPath: join(dir, "rag.db") })).toThrow(/native addon is not built/);
      expect(() => emptyIndexRemedy({ slug: "p", legacyPath })).toThrow(/native addon is not built/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
