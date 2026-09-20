// KJC-BUG-0190 — cold start. On a brand new project the RAG index is empty:
// `kj rag query` warns and returns nothing, so the ledger records a query with
// zero hits. The first write of a file passed (fresh file + some query), but
// every later EDIT was denied, and consulting again could not fix it because
// there is nothing indexed to return. The gate must not demand the impossible.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, gate, post;
const env = { KJ_ALLOW_IDENTITY: "1" };
const hook = (script, payload) => spawnSync("node", [script], {
  input: JSON.stringify({ session_id: "s1", ...payload }),
  encoding: "utf8", cwd: dir, env: { ...process.env, ...env },
});
const edit = (rel) => hook(gate, { tool_name: "Edit", tool_input: { file_path: path.join(dir, rel) } });
const ragQuery = (output) => hook(post, {
  tool_name: "Bash",
  tool_input: { command: "kj rag query what does src/a.js do" },
  tool_response: output,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-empty-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.js"), "x\n");
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git add -A && git commit -q -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  post = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("rag-first × an index that has nothing to return", () => {
  it("lets the edit through once the RAG said it has no chunks indexed", () => {
    expect(edit("src/a.js").status).toBe(2); // no query at all: still denied
    ragQuery("[rag] No chunks indexed yet. Run 'kj rag index' first.");
    expect(edit("src/a.js").status).toBe(0);
  });

  it("recognises the same answer in its json form", () => {
    ragQuery(JSON.stringify({ hits: [], empty: true, topK: 8 }));
    expect(edit("src/a.js").status).toBe(0);
  });

  it("a query that simply found nothing on a live index still denies", () => {
    ragQuery("[rag] nothing matched that question");
    expect(edit("src/a.js").status).toBe(2);
  });
});
