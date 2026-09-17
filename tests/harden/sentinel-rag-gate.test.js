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
const env = { KJ_ALLOW_IDENTITY: "1" };
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

  it("a new file only needs the session to have consulted at all", () => {
    expect(edit("lib/new.js").status).toBe(2); // no query at all
    ledger(["src/a.js"]);
    expect(edit("lib/new.js").status).toBe(0);
  });

  it("leaves docs and tests alone", () => {
    expect(edit("README.md").status).toBe(0);
    expect(edit("tests/a.test.js").status).toBe(0);
  });

  it("KJ_ALLOW_NO_RAG opens the gate and is recorded once for the session", () => {
    expect(edit("src/a.js", { KJ_ALLOW_NO_RAG: "1" }).status).toBe(0);
    expect(edit("src/b.js", { KJ_ALLOW_NO_RAG: "1" }).status).toBe(0);
    const s = JSON.parse(fs.readFileSync(statePath, "utf8")).sessions.s1;
    expect(s.escapes).toEqual(["KJ_ALLOW_NO_RAG"]);
  });
});
