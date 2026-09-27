// KJC-TSK-0883 (ADR 0011): con un indice por proyecto, el canon comun de la
// maquina no puede copiarse en cada proyecto ni contaminarlo. Vive en su propia
// base (~/.karajan/library.db); las fichas de <proyecto>/.karajan/library/ son
// de ese proyecto y van a su base, con su slug, para que sus consultas las vean.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { indexLibrary, LIBRARY_PROJECT, libraryDirs } from "../../src/rag/library.js";
import { libraryDbPath } from "../../src/rag/project-store.js";
import { openVecStore } from "../../src/rag/vec-store.js";

const embedder = { embed: async () => { const v = new Float32Array(8); v[0] = 1; return v; } };
const logger = { info() {}, warn() {} };
let tmp, pkgDir, homeDir, projDir, db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kj-libdb-"));
  pkgDir = join(tmp, "pkg"); homeDir = join(tmp, "home"); projDir = join(tmp, "proj");
  for (const [dir, card] of [[pkgDir, "shipped"], [join(homeDir, ".karajan", "library"), "user"], [join(projDir, ".karajan", "library"), "local"]]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${card}.md`), `# ${card} card\n\nBody of the ${card} card.\n`);
  }
  db = openVecStore({ dim: 8, path: join(tmp, "x.db") });
});
afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

const rows = () => db.prepare("SELECT project_slug AS p, source FROM chunks").all();

describe("library por alcance", () => {
  it("machine: solo el canon que trae kj y el del usuario, bajo el proyecto library", async () => {
    await indexLibrary({ db, embedder, logger, pkgLibraryDir: pkgDir, home: homeDir, projectDir: projDir, scope: "machine" });
    expect(rows().every((r) => r.p === LIBRARY_PROJECT)).toBe(true);
    expect(rows().some((r) => r.source.includes("local.md"))).toBe(false);
    expect(rows().some((r) => r.source.includes("shipped.md"))).toBe(true);
  });

  it("project: solo las fichas del proyecto, con su slug", async () => {
    await indexLibrary({ db, embedder, logger, pkgLibraryDir: pkgDir, home: homeDir, projectDir: projDir, scope: "project", project: "proj" });
    expect(rows().map((r) => r.p)).toEqual(expect.arrayContaining(["proj"]));
    expect(rows().every((r) => r.p === "proj" && r.source.includes("local.md"))).toBe(true);
  });

  it("sin alcance se comporta como antes: los tres directorios", () => {
    expect(libraryDirs({ pkgLibraryDir: pkgDir, home: homeDir, projectDir: projDir })).toHaveLength(3);
  });

  it("kj rag query --library lee la base del canon, y vacia pide kj rag index, no migrar", async () => {
    const prev = process.env.KJ_LIBRARY_DB;
    process.env.KJ_LIBRARY_DB = join(tmp, "lib.db");
    const warn = [];
    try {
      const { ragQueryCommand } = await import("../../src/commands/rag.js");
      const hits = await ragQueryCommand({ text: "x", config: { projectDir: projDir, rag: { embedder: { dim: 8 }, autoUpdate: false } }, logger: { info() {}, warn: (m) => warn.push(m) }, flags: { library: true, ragUpdate: false } });
      expect(hits).toEqual([]);
      expect(warn.join("\n")).toMatch(/the library index holds no chunks of library: this is not an answer, run kj rag index$/m);
    } finally {
      if (prev === undefined) delete process.env.KJ_LIBRARY_DB; else process.env.KJ_LIBRARY_DB = prev;
    }
  });

  it("la base de la library vive en el home de kj, y KJ_LIBRARY_DB manda", () => {
    const prev = process.env.KJ_LIBRARY_DB;
    try {
      delete process.env.KJ_LIBRARY_DB;
      expect(libraryDbPath()).toMatch(/library\.db$/);
      process.env.KJ_LIBRARY_DB = join(tmp, "lib.db");
      expect(libraryDbPath()).toBe(join(tmp, "lib.db"));
    } finally {
      if (prev === undefined) delete process.env.KJ_LIBRARY_DB; else process.env.KJ_LIBRARY_DB = prev;
    }
  });
});
