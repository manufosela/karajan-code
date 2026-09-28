// KJC-TSK-0891 (#1807 punto 4, decision del usuario 28-sep): el indice no puede
// depender de una lista de extensiones, porque hay infinidad de lenguajes. Entra
// cualquier fichero de texto que el proyecto versiona; lo que se deja fuera se
// deja por su NATURALEZA (binario, generado, enorme, excluido), no por su lenguaje.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { indexableReason, listProjectFiles } from "../../src/rag/indexable.js";

let dir;
const put = (rel, content) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), content);
};
const reason = (rel, opts = {}) => indexableReason(rel, join(dir, rel), opts);

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-indexable-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("indexableReason", () => {
  it("cualquier texto entra, sea el lenguaje que sea", () => {
    for (const f of ["src/Page.astro", "app/User.php", "lib/a.rb", "db/q.sql", "run.sh", "App.kt", "View.swift", "x.ex", "README.md"]) {
      put(f, "some text\n");
      expect(reason(f), f).toBeNull();
    }
  });

  it("fuera por naturaleza, con su motivo", () => {
    put("img.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    expect(reason("img.png")).toMatch(/binary/);
    for (const f of ["package-lock.json", "yarn.lock", "Cargo.lock", "dist.min.js", "a.js.map", "__snapshots__/x.snap"]) {
      put(f, "x\n");
      expect(reason(f), f).toMatch(/generated/);
    }
    put("big.txt", "x".repeat(600 * 1024));
    expect(reason("big.txt")).toMatch(/larger than/);
  });

  it("un enlace simbolico nunca se sigue: podria llevar al embedder un fichero de fuera", () => {
    const outside = mkdtempSync(join(tmpdir(), "kj-outside-"));
    try {
      writeFileSync(join(outside, "secret.env"), "TOKEN=x\n");
      symlinkSync(join(outside, "secret.env"), join(dir, "link.env"));
      symlinkSync(outside, join(dir, "linkdir"));
      expect(reason("link.env")).toMatch(/symbolic link/);
      expect(reason("linkdir")).toMatch(/symbolic link/);
      mkdirSync(join(dir, "adir"));
      expect(reason("adir")).toMatch(/not a regular file/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("lo que puede guardar secretos no va nunca al embedder", () => {
    for (const f of [".env", ".env.production", "certs/server.key", "tls.pem", ".ssh/id_ed25519"]) {
      put(f, "x\n");
      expect(reason(f), f).toMatch(/may hold secrets/);
    }
  });

  it("el proyecto excluye con rag.exclude, y las rutas que el indexador siempre salta siguen fuera", () => {
    put("public/docs/index.html", "<p>x</p>\n");
    expect(reason("public/docs/index.html", { exclude: ["public/docs/**"] })).toMatch(/rag\.exclude/);
    put("node_modules/a/index.js", "x\n");
    expect(reason("node_modules/a/index.js")).toMatch(/always skips/);
  });
});

describe("listProjectFiles", () => {
  it("lo que git versiona o ve sin ignorar, nunca lo ignorado", () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    put(".gitignore", "secret.txt\n");
    put("a.txt", "a\n");
    put("secret.txt", "s\n");
    expect(listProjectFiles(dir).sort()).toEqual([".gitignore", "a.txt"]);
  });
});
