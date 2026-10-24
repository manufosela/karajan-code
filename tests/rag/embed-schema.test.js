// KJC-TSK-1171 (RAG-B): an index records the embed schema it was built with, next to its
// store; nothing recorded means the index predates the header and must be rebuilt.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root, prevHome;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-embed-schema-"));
  prevHome = process.env.KARAJAN_HOME;
  process.env.KARAJAN_HOME = join(root, ".karajan");
  mkdirSync(process.env.KARAJAN_HOME, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
});

describe("embed schema marker", () => {
  it("is 1 with nothing recorded, and what was written after a full index", async () => {
    const { readEmbedSchema, writeEmbedSchema } = await import("../../src/rag/embed-schema.js");
    const { EMBED_SCHEMA } = await import("../../src/rag/embed-header.js");
    const { projectDbPath } = await import("../../src/rag/project-store.js");
    const projectDir = join(root, "proj");
    mkdirSync(dirname(projectDbPath(projectDir)), { recursive: true });
    expect(readEmbedSchema(projectDir)).toBe(1);
    writeEmbedSchema(projectDir);
    expect(readEmbedSchema(projectDir)).toBe(EMBED_SCHEMA);
    writeFileSync(`${projectDbPath(projectDir)}.embed-schema`, "garbage\n");
    expect(() => readEmbedSchema(projectDir)).toThrow(/embed schema number/);
  });
});
