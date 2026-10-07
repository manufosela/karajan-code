// KJC-TSK-0848 (ADR 0010, RAG-B) — rag-first gate: a source the RAG never
// returned in this session (nor a sibling of its directory) cannot be edited;
// a new file only needs the session to have consulted at all; docs, config and
// tests stay out; KJ_ALLOW_NO_RAG is the sealed, once-per-session escape.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, gate, statePath;
const env = {};
const edit = (rel, extra = {}) => spawnSync("node", [gate], {
  input: JSON.stringify({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(dir, rel) } }),
  encoding: "utf8", cwd: dir, env: { ...process.env, ...env, ...extra },
});
const ledger = (hits, queries = hits.length) => fs.writeFileSync(statePath, JSON.stringify({
  sessions: { s1: { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0, rag_hits: hits, rag_queries: Array.from({ length: queries }, (_, i) => ({ ts: i, text: "q", hits })) } },
}));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-gate-"));
  for (const f of ["src/a.js", "src/b.js", "lib/c.js", "tests/a.test.js", "README.md"]) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), "x\n");
  }
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git add -A && git commit -q -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("rag-first gate", () => {
  it("denies editing a source the session never asked the RAG about, naming the query to run", () => {
    const r = edit("src/a.js");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/rag-first/);
    expect(r.stderr).toMatch(/src\/a\.js/);
    expect(r.stderr).toMatch(/#rag-first/);
  });

  it("passes when the ledger holds the file or a sibling of its directory, and still denies another directory", () => {
    ledger(["src/a.js"]);
    expect(edit("src/a.js").status).toBe(0);
    expect(edit("src/b.js").status).toBe(0); // sibling: the RAG answered about this zone
    expect(edit("lib/c.js").status).toBe(2);
  });

  // KJC-BUG-0293 (#1996): the deny names the hits that fell outside the tree, so
  // the person learns the index was built from another path instead of
  // querying again and again.
  it("names the hits dropped as outside the tree, and the root they were compared against", () => {
    fs.writeFileSync(statePath, JSON.stringify({
      sessions: { s1: { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0, rag_hits: [], rag_queries: [{ ts: 1, text: "q", hits: [] }], rag_dropped: { root: dir, count: 3, sample: ["/elsewhere/proj/src/a.js"] } } },
    }));
    // The index HAS the file (a fake kj answers `rag covers` so the suite never
    // depends on the linked kj): the gate reaches its "never asked" verdict.
    const fakeBin = path.join(dir, "fakebin");
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(fakeBin, "kj"), '#!/bin/sh\necho \'{"state":"indexed","rel":"src/a.js","canAnswer":true}\'\n', { mode: 0o755 });
    const r = edit("src/a.js", { PATH: `${fakeBin}:${process.env.PATH}` });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/3 hit\(s\) fuera de este arbol/);
    expect(r.stderr).toContain("/elsewhere/proj/src/a.js");
    expect(r.stderr).toMatch(/kj rag index --with-sources/);
  });

  it("a new file only needs the session to have consulted at all", () => {
    expect(edit("lib/new.js").status).toBe(2); // no query at all
    ledger(["src/a.js"]);
    expect(edit("lib/new.js").status).toBe(0);
  });

  // KJC-BUG-0210: "nuevo" era "no existe en disco", asi que en cuanto lo creabas
  // la siguiente edicion exigia una respuesta del RAG sobre un fichero que el
  // indice no puede tener. Un fichero que git no conoce no puede estar indexado.
  it("un fichero creado en la sesion sigue siendo nuevo: git no lo conoce, el indice tampoco", () => {
    ledger(["src/a.js"]);
    const nuevo = path.join(dir, "lib", "nuevo.js");
    expect(edit("lib/nuevo.js").status).toBe(0); // todavia no existe
    fs.writeFileSync(nuevo, "creado en esta sesion\n");
    expect(edit("lib/nuevo.js").status).toBe(0); // existe, pero git no lo conoce
    execSync("git add lib/nuevo.js && git -c user.email=a@b.c -c user.name=t commit -q -m add", { cwd: dir });
    expect(edit("lib/nuevo.js").status).toBe(2); // ya es trackeado: el RAG puede responder
  });

  it("sin haber consultado nada, un fichero que git no conoce tampoco pasa", () => {
    fs.writeFileSync(path.join(dir, "lib", "otro.js"), "x\n");
    expect(edit("lib/otro.js").status).toBe(2);
  });

  it("un nombre que parece una opcion de git sigue siendo un fichero (catch de la review)", () => {
    ledger(["src/a.js"]);
    fs.writeFileSync(path.join(dir, "lib", "--version"), "x\n");
    expect(edit("lib/--version").status).toBe(0);
  });

  it("leaves docs and tests alone", () => {
    expect(edit("README.md").status).toBe(0);
    expect(edit("tests/a.test.js").status).toBe(0);
  });

  it("KJ_ALLOW_NO_RAG no longer opens the gate, and the deny names no escape (ADR 0015)", () => {
    const r = edit("src/a.js", { KJ_ALLOW_NO_RAG: "1" });
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain("KJ_ALLOW_NO_RAG=1");
  });
});
