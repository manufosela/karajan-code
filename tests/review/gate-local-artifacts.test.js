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

import { CONTRACT_BLOCK, excludeLocalArtifacts } from "../../src/review/gate-gitignore.js";

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
    expect(res.added).toContain(".kj-ready.json");
    expect(read()).toContain(".kj-ready.json");
    // Lo del equipo se queda EXACTAMENTE como estaba.
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe("vendor/\nstorage/logs/\n");
  });

  it("es idempotente y respeta lo que ya hubiera en info/exclude", async () => {
    writeFileSync(excludePath(), "mio.txt\n.reviews/\n");
    const first = await excludeLocalArtifacts(repo, fakeGit);
    expect(first.added).not.toContain(".reviews/");
    expect(first.added).toContain(".kj/");
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

/**
 * KJC-BUG-0220: lo que kj escribe DENTRO de .karajan/ tampoco viaja, y no
 * estaba en la lista, asi que en un proyecto ajeno se quedaba como `??`
 * permanente en git status. Reportado desde otro repo tras dias de ruido.
 */
describe("lo que kj deja en .karajan/", () => {
  it("excluye el harness del anfitrion y los registros locales", async () => {
    const { added } = await excludeLocalArtifacts(repo, fakeGit);
    for (const a of [".karajan/harness/", ".karajan/policy-decisions.jsonl", ".karajan/policy-exceptions.jsonl", ".karajan/identity.local.yml"]) {
      expect(added, a).toContain(a);
    }
  });

  it("NO esconde lo que un equipo puede querer versionar", async () => {
    const { added } = await excludeLocalArtifacts(repo, fakeGit);
    // La config del proyecto y las reglas del agente son decision del equipo,
    // y los ficheros del supervisor viajan por su cauce sellado (ADR 0009).
    for (const keep of [".karajan/kj.config.yml", ".karajan/coder-rules.md", ".karajan/review-rules.md", ".karajan/hooks/", ".karajan/adrs/", ".karajan/policy.yml", ".karajan/supervisor-provenance.json"]) {
      expect(added.some((a) => a.includes(keep.replace(".karajan/", ""))), keep).toBe(false);
    }
  });

  it("ninguna exclusion pisa lo que el contrato del .gitignore re-incluye", async () => {
    // Las dos listas viven en este mismo modulo y dicen cosas opuestas sobre
    // .karajan/: si una excluye lo que la otra promete versionar, el contrato
    // del equipo deja de llegar a git sin que nadie lo note.
    const promised = CONTRACT_BLOCK.filter((l) => l.startsWith("!")).map((l) => l.slice(1));
    const { added } = await excludeLocalArtifacts(repo, fakeGit);
    for (const p of promised) {
      expect(added.some((a) => p === a || p.startsWith(a)), p).toBe(false);
    }
  });
});
