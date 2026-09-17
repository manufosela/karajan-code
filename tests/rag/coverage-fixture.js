// Shared fixture for the RAG coverage tests (KJC-TSK-0850): a real temp git
// repo with sources under src/, scripts/ and packages/*/src, a non-code
// bin/tool, an ignored node_modules/, and a temp vec store (dim 8).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execaSync } from "execa";
import { openVecStore, insertChunk, projectSlug } from "../../src/rag/vec-store.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const oneHot = (i) => { const v = new Float32Array(8); v[i] = 1; return v; };

export function makeCoverageRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-cov-"));
  const repo = path.join(root, "myproj");
  const files = [["src/a.js", "export const x = 1;\n"], ["scripts/b.js", "export const x = 1;\n"], ["packages/x/src/c.js", "export const x = 1;\n"], ["node_modules/n/d.js", "export const x = 1;\n"], ["bin/tool", "#!/bin/sh\n"], ["README.md", "# doc\n"], [".gitignore", "node_modules/\n"]];
  for (const [f, body] of files) {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    fs.writeFileSync(path.join(repo, f), body);
  }
  const git = (...args) => execaSync("git", ["-C", repo, ...args], { env: GIT_ENV });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const dbFile = path.join(root, "rag.db");
  const db = openVecStore({ dim: 8, path: dbFile });
  const slug = projectSlug(repo);
  return {
    root, repo, dbFile, db, slug, git,
    head: () => git("rev-parse", "HEAD").stdout.trim(),
    index: (rel, i) => insertChunk(db, { source: path.join(repo, rel), kind: "code", text: rel, embedding: oneHot(i), project: slug }),
    cleanup: () => { db.close(); fs.rmSync(root, { recursive: true, force: true }); },
  };
}
