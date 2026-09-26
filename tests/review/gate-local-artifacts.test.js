/**
 * KJC-BUG-0213 (issue #1734): el .gitignore es del equipo. Un `kj_run` sobre un
 * repo Laravel le escribio `*.log`, `.reviews/` y un bloque de TypeScript sin
 * pedir permiso, y el coder se encontro el fichero modificado teniendo que
 * razonar si venia de antes. Los artefactos de kj son locales y van donde no
 * molestan: .git/info/exclude, que no viaja con el repo.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { excludeLocalArtifacts } from "../../src/review/gate-gitignore.js";

let repo;
const excludePath = () => join(repo, ".git", "info", "exclude");
const read = () => (existsSync(excludePath()) ? readFileSync(excludePath(), "utf8") : "");
// git responde la ruta relativa al repo, como en un clon normal.
const fakeGit = async () => ({ exitCode: 0, stdout: ".git/info/exclude\n", stderr: "" });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-exclude-"));
  mkdirSync(join(repo, ".git", "info"), { recursive: true });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("excludeLocalArtifacts", () => {
  it("excluye los artefactos de kj en info/exclude, no en el .gitignore del equipo", async () => {
    writeFileSync(join(repo, ".gitignore"), "vendor/\nstorage/logs/\n");
    const res = await excludeLocalArtifacts(repo, fakeGit);
    expect(res.changed).toBe(true);
    expect(res.added).toEqual([".reviews/", ".kj/", ".kj-ready.json"]);
    expect(read()).toContain(".kj-ready.json");
    // Lo del equipo se queda EXACTAMENTE como estaba.
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe("vendor/\nstorage/logs/\n");
  });

  it("es idempotente y respeta lo que ya hubiera en info/exclude", async () => {
    writeFileSync(excludePath(), "mio.txt\n.reviews/\n");
    const first = await excludeLocalArtifacts(repo, fakeGit);
    expect(first.added).toEqual([".kj/", ".kj-ready.json"]);
    const second = await excludeLocalArtifacts(repo, fakeGit);
    expect(second.changed).toBe(false);
    expect(read()).toContain("mio.txt");
    expect(read().match(/\.kj-ready\.json/g)).toHaveLength(1);
  });

  it("funciona en un worktree, donde git responde una ruta absoluta", async () => {
    const real = join(repo, "otro-sitio", "info", "exclude");
    mkdirSync(join(repo, "otro-sitio", "info"), { recursive: true });
    const gitAbs = async () => ({ exitCode: 0, stdout: `${real}\n`, stderr: "" });
    expect((await excludeLocalArtifacts(repo, gitAbs)).changed).toBe(true);
    expect(readFileSync(real, "utf8")).toContain(".kj/");
    expect(read()).toBe("");
  });

  it("sin git utilizable no revienta: cae a la ruta por defecto", async () => {
    const gitDown = async () => { throw new Error("git: not found"); };
    expect((await excludeLocalArtifacts(repo, gitDown)).changed).toBe(true);
    expect(read()).toContain(".reviews/");
  });
});
