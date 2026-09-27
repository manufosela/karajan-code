// KJC-TSK-0888 (RAG-P1a, ADR 0011): pasar al indice por proyecto no puede
// costar horas de reindexado con Ollama ni dejar al proyecto sin indice entre
// medias. Los chunks de ESTE proyecto se copian de la base global a la suya con
// sus embeddings tal cual: cero recomputo, nada de los demas.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migrateProjectIndex } from "../../src/rag/migrate.js";
import { openVecStore, insertChunk, countChunks, getLastIndexedCommit, setLastIndexedCommit, searchSimilar } from "../../src/rag/vec-store.js";

let root, legacy, target;
const vec = (i) => { const v = new Float32Array(8); v[i] = 1; return v; };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kj-migrate-"));
  legacy = path.join(root, "global.db");
  target = path.join(root, "proj", ".karajan", "rag.db");
  const db = openVecStore({ dim: 8, path: legacy });
  insertChunk(db, { source: "/p/src/a.js", kind: "code", text: "mio A", embedding: vec(0), project: "mio" });
  insertChunk(db, { source: "/p/src/b.js", kind: "code", text: "mio B", embedding: vec(1), project: "mio", contentHash: "h1", metadata: { line: 7 } });
  insertChunk(db, { source: "/q/src/z.js", kind: "code", text: "ajeno", embedding: vec(2), project: "ajeno" });
  setLastIndexedCommit(db, "mio", "abc123");
  db.close();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("migrateProjectIndex", () => {
  it("copia SOLO los chunks del proyecto, con sus embeddings y su marca de commit", () => {
    const res = migrateProjectIndex({ slug: "mio", legacyPath: legacy, targetPath: target, dim: 8 });
    expect(res).toMatchObject({ migrated: 2, state: "migrated" });
    const db = openVecStore({ dim: 8, path: target });
    try {
      expect(countChunks(db)).toBe(2);
      expect(getLastIndexedCommit(db, "mio")).toBe("abc123");
      // El embedding llega intacto: la busqueda por el vector de B devuelve B.
      expect(searchSimilar(db, vec(1), 1)[0].text).toBe("mio B");
      // La metadata ya serializada se copia tal cual, sin doble JSON.stringify.
      const meta = db.prepare("SELECT metadata FROM chunks WHERE text = 'mio B'").get().metadata;
      expect(JSON.parse(meta)).toEqual({ line: 7 });
    } finally { db.close(); }
  });

  it("no toca la base global", () => {
    migrateProjectIndex({ slug: "mio", legacyPath: legacy, targetPath: target, dim: 8 });
    const db = openVecStore({ dim: 8, path: legacy });
    try { expect(countChunks(db)).toBe(3); } finally { db.close(); }
  });

  it("no duplica si el indice del proyecto ya tiene chunks", () => {
    migrateProjectIndex({ slug: "mio", legacyPath: legacy, targetPath: target, dim: 8 });
    const again = migrateProjectIndex({ slug: "mio", legacyPath: legacy, targetPath: target, dim: 8 });
    expect(again).toMatchObject({ migrated: 0, state: "already" });
  });

  it("un indice del proyecto con chunks de OTRO repo no cuenta como ya migrado", () => {
    // Visto en esta maquina: un .karajan/rag.db viejo con 42 chunks ajenos.
    const stale = openVecStore({ dim: 8, path: target });
    insertChunk(stale, { source: "/r/x.js", kind: "code", text: "resto", embedding: vec(3), project: "viejo" });
    stale.close();
    expect(migrateProjectIndex({ slug: "mio", legacyPath: legacy, targetPath: target, dim: 8 })).toMatchObject({ state: "migrated", migrated: 2 });
  });

  it("sin nada del proyecto en la base global lo dice y nombra el remedio", () => {
    const res = migrateProjectIndex({ slug: "otro", legacyPath: legacy, targetPath: target, dim: 8 });
    expect(res).toMatchObject({ migrated: 0, state: "nothing" });
    expect(res.reason).toMatch(/kj rag index --with-sources/);
  });

  it("sin base global no revienta", () => {
    const res = migrateProjectIndex({ slug: "mio", legacyPath: path.join(root, "no.db"), targetPath: target, dim: 8 });
    expect(res.state).toBe("nothing");
  });
});
