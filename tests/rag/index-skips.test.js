// KJC-BUG-0231: el indice de karajan-code devolvia copias de
// .claude/worktrees/agent-*/src/... (repos enteros que Claude Code crea para
// sus subagentes) compitiendo con el fichero real. Y las exclusiones se
// juzgaban sobre la ruta ABSOLUTA: un proyecto bajo un directorio llamado
// build, dist o coverage no indexaba nada.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { indexProject } from "../../src/rag/indexer.js";
import { insertChunk, openVecStore } from "../../src/rag/vec-store.js";

const embedder = { dim: 8, embed: async () => { const v = new Float32Array(8); v[0] = 1; return v; } };
const logger = { info: () => {}, warn: () => {} };
let root, db;

const put = (rel, text) => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
  return abs;
};
const sources = () => db.prepare("SELECT DISTINCT source FROM chunks").all().map((r) => r.source.slice(root.length + 1)).sort();

beforeEach(() => {
  // El proyecto vive DENTRO de un directorio llamado "build".
  root = join(mkdtempSync(join(tmpdir(), "kj-skips-")), "build", "proj");
  mkdirSync(root, { recursive: true });
  db = openVecStore({ dim: 8, path: join(root, "..", "rag.db") });
});
afterEach(() => { db.close(); rmSync(join(root, "..", ".."), { recursive: true, force: true }); });

describe("indexProject --with-sources", () => {
  it("indexa un proyecto que vive bajo un directorio llamado build", async () => {
    put("src/a.js", "export const a = 1;\n");
    await indexProject(root, { db, embedder, karajanHome: join(root, "..", "home"), logger, withSources: true });
    expect(sources()).toEqual(["src/a.js"]);
  });

  it("no indexa las copias de .claude/worktrees", async () => {
    put("src/a.js", "export const a = 1;\n");
    put(".claude/worktrees/agent-1/src/a.js", "export const a = 2;\n");
    await indexProject(root, { db, embedder, karajanHome: join(root, "..", "home"), logger, withSources: true });
    expect(sources()).toEqual(["src/a.js"]);
  });

  it("purga lo que un indice anterior guardo de rutas que hoy se excluyen", async () => {
    put("src/a.js", "export const a = 1;\n");
    const stale = put(".claude/worktrees/agent-1/src/b.js", "export const b = 1;\n");
    const v = new Float32Array(8); v[1] = 1;
    insertChunk(db, { source: stale, kind: "code", text: "b", embedding: v, project: "proj" });
    await indexProject(root, { db, embedder, karajanHome: join(root, "..", "home"), logger, withSources: true });
    expect(sources()).toEqual(["src/a.js"]);
  });
});
