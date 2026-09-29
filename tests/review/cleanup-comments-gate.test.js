// KJC-BUG-0235 contra git real: el caso de grebla #948, borrar codigo y
// corregir el comentario que se quedaba mintiendo, llega al gate como limpieza;
// anadir una linea de codigo, no.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { markCommentOnlyAdditions } from "../../src/commands/review-gate.js";

let dir, cwd;
const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
const numstat = () => git("diff", "--cached", "--numstat").trim().split("\n").map((l) => {
  const [a, r, f] = l.split(/\s+/);
  return { file: f, added: Number(a), removed: Number(r) };
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-cleanup-"));
  git("init", "-q");
  writeFileSync(join(dir, "index.js"), ["// LEAN / Flujo", "export const KEY = 1;", "export function dead() {", "  return 2;", "}", ""].join("\n"));
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  cwd = process.cwd();
  process.chdir(dir); // rawDiff runs git in the cwd, as the CLI does
});
afterEach(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });

describe("markCommentOnlyAdditions (git real)", () => {
  it("borrar codigo y corregir el comentario: marcado como solo comentarios", async () => {
    writeFileSync(join(dir, "index.js"), ["// La clave se queda: la usa Poker.", "export const KEY = 1;", ""].join("\n"));
    git("add", "-A");
    const ns = numstat();
    await markCommentOnlyAdditions(ns, { range: undefined, projectDir: dir });
    expect(ns[0]).toMatchObject({ file: "index.js", added: 1, commentOnly: true });
  });

  it("lee el INDICE: un cambio sin stagear no puede hacer pasar por comentario codigo stageado", async () => {
    writeFileSync(join(dir, "index.js"), ["// x", "export const KEY = 2;", ""].join("\n"));
    git("add", "-A");
    writeFileSync(join(dir, "index.js"), ["// x", "// KEY = 2", ""].join("\n")); // sin stagear
    const ns = numstat();
    await markCommentOnlyAdditions(ns, { range: undefined, projectDir: dir });
    expect(ns[0].commentOnly).toBe(false);
  });

  it("anadir una linea de codigo: no se marca", async () => {
    writeFileSync(join(dir, "index.js"), ["// La clave se queda.", "export const KEY = 2;", ""].join("\n"));
    git("add", "-A");
    const ns = numstat();
    await markCommentOnlyAdditions(ns, { range: undefined, projectDir: dir });
    expect(ns[0].commentOnly).toBe(false);
  });
});
