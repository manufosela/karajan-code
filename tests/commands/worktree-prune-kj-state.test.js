// KJC-TSK-1477 (owner's decision, 9-nov): what kj itself leaves in a lane never keeps a merged
// lane alive. Caches, index and traces go with it; the governance record (gate decisions,
// review verdicts, handoffs) is archived in the main checkout first; a pending handoff keeps it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { worktreeCommand } from "../../src/commands/worktree.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args]).toString();
const noProcesses = { processes: { cwds: new Set(), unseen: 0 } };
const prune = (flags = {}) => worktreeCommand({ config: { projectDir: dir }, action: "prune", args: [], flags, deps: noProcesses });
const lane = async (slug) => (await worktreeCommand({ config: { projectDir: dir }, action: "start", args: [slug], flags: {} })).path;
const put = (root, rel, body = "x\n") => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const archived = (slug, rel) => path.join(dir, ".karajan", "retired-lanes", slug, rel);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-wtkjstate-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  put(dir, ".gitignore", ".karajan/\n.kj/\nnode_modules/\n");
  git("add", ".gitignore"); git("commit", "-qm", "base");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("kj worktree prune and kj's own state (KJC-TSK-1477)", () => {
  it("retires a merged lane holding only kj state, archiving its governance record first", async () => {
    const p = await lane("done");
    for (const rel of [".karajan/board-cache.json", ".karajan/traces/denials.jsonl", ".karajan/rag.db.worktree-paths", ".kj/run.log"]) put(p, rel);
    put(p, ".karajan/policy-decisions.jsonl", "{\"decision\":\"allow\"}\n");
    put(p, ".karajan/reviews/abc.json", "{\"verdict\":\"approved\"}\n");
    put(p, ".karajan/handoffs/0123abcd.json", "{\"status\":\"done\"}\n");
    const r = await prune();
    expect(r.removed.map((l) => l.slug)).toEqual(["done"]);
    expect(fs.existsSync(p)).toBe(false);
    expect(fs.readFileSync(archived("done", ".karajan/policy-decisions.jsonl"), "utf8")).toBe("{\"decision\":\"allow\"}\n");
    expect(fs.existsSync(archived("done", ".karajan/reviews/abc.json"))).toBe(true);
    expect(fs.existsSync(archived("done", ".karajan/handoffs/0123abcd.json"))).toBe(true);
    expect(fs.existsSync(archived("done", ".karajan/board-cache.json"))).toBe(false);
  });

  it("keeps a lane with a pending handoff, saying so", async () => {
    const p = await lane("waiting");
    put(p, ".karajan/handoffs/0123abcd.json", "{\"status\":\"pending\"}\n");
    const r = await prune();
    expect(r.removed).toEqual([]);
    expect(r.kept[0].reasons.join()).toMatch(/pending handoff/);
  });

  it("a nested regenerable dir does not keep the lane; a nested ignored secret does", async () => {
    put(dir, ".gitignore", ".karajan/\n.kj/\nnode_modules/\n.env\n");
    git("add", ".gitignore"); git("commit", "-qm", "env");
    put(await lane("nested"), "packages/x/node_modules/y.js");
    put(await lane("secret"), "packages/x/.env", "SECRET=1\n");
    const r = await prune();
    expect(r.removed.map((l) => l.slug)).toEqual(["nested"]);
    expect(r.kept.map((l) => l.slug)).toEqual(["secret"]);
  });

  it("kj worktree done archives the governance record too", async () => {
    put(await lane("closed"), ".karajan/reviews/abc.json");
    await worktreeCommand({ config: { projectDir: dir }, action: "done", args: ["closed"], flags: {}, deps: { stopBootstrap: async () => null } });
    expect(fs.existsSync(archived("closed", ".karajan/reviews/abc.json"))).toBe(true);
  });

  it("a dry run archives nothing", async () => {
    put(await lane("dry"), ".karajan/policy-decisions.jsonl");
    const r = await prune({ dryRun: true });
    expect(r.wouldRemove.map((l) => l.slug)).toEqual(["dry"]);
    expect(fs.existsSync(path.join(dir, ".karajan", "retired-lanes"))).toBe(false);
  });
});
