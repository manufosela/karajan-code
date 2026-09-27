// KJC-TSK-0882 (RAG-P1, ADR 0011): el indice del RAG era UNA base para toda la
// maquina (~/.karajan/rag.db, 427 MB, 19 proyectos) con un indice vectorial sin
// particion: la KNN sacaba los vecinos de TODOS los proyectos y filtraba por el
// tuyo despues, asi que un proyecto pequeno podia recibir cero resultados con el
// chunk perfecto indexado. Cada proyecto tiene ahora su propio indice.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { projectDbPath, openProjectStore } from "../../src/rag/project-store.js";
import { insertChunk, countChunks } from "../../src/rag/vec-store.js";

let root, prevDb;
const repo = (name) => {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  execFileSync("git", ["-C", dir, "init", "-q"]);
  return dir;
};
const vec = () => { const v = new Float32Array(8); v[0] = 1; return v; };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kj-projstore-"));
  prevDb = process.env.KJ_RAG_DB;
  delete process.env.KJ_RAG_DB;
});
afterEach(() => {
  if (prevDb === undefined) delete process.env.KJ_RAG_DB; else process.env.KJ_RAG_DB = prevDb;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("projectDbPath", () => {
  it("vive en .karajan/rag.db de la raiz del proyecto, tambien desde un subdirectorio", () => {
    const a = repo("a");
    // git devuelve la ruta real (en macOS /tmp es un enlace), asi que se compara contra ella.
    expect(projectDbPath(a)).toBe(path.join(fs.realpathSync(a), ".karajan", "rag.db"));
    expect(projectDbPath(path.join(a, "src"))).toBe(projectDbPath(a));
  });

  it("KJ_RAG_DB explicito sigue mandando", () => {
    process.env.KJ_RAG_DB = path.join(root, "elegido.db");
    expect(projectDbPath(repo("a"))).toBe(path.join(root, "elegido.db"));
  });
});

describe("openProjectStore", () => {
  it("dos proyectos no se ven: indexar uno no toca el fichero del otro", () => {
    const a = repo("a");
    const b = repo("b");
    const dbA = openProjectStore({ projectDir: a, dim: 8 });
    insertChunk(dbA, { source: path.join(a, "src/x.js"), kind: "code", text: "x", embedding: vec(), project: "a" });
    dbA.close();
    const dbB = openProjectStore({ projectDir: b, dim: 8 });
    expect(countChunks(dbB)).toBe(0);
    dbB.close();
    const again = openProjectStore({ projectDir: a, dim: 8 });
    expect(countChunks(again)).toBe(1);
    again.close();
  });
});
