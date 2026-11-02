// KJC-TSK-1036 (owner's decision, 14-oct): kj retires the lanes it created when
// they are provably abandoned (clean tree, no commits beyond the base, no live
// process inside), also from an agent session; anything else is listed, never touched.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { worktreeCommand } from "../../src/commands/worktree.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args]).toString();
const noProcesses = { processes: { cwds: new Set(), unseen: 0 } };
const prune = (flags = {}, deps = noProcesses) => worktreeCommand({ config: { projectDir: dir }, action: "prune", args: [], flags, deps });
const lane = async (slug) => (await worktreeCommand({ config: { projectDir: dir }, action: "start", args: [slug], flags: {} })).path;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-wtprune-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  git("add", "a.js"); git("commit", "-qm", "base");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("kj worktree prune", () => {
  it("retires an abandoned lane and its branch", async () => {
    const p = await lane("old");
    const r = await prune();
    expect(r.removed.map((l) => l.slug)).toEqual(["old"]);
    expect(fs.existsSync(p)).toBe(false);
    expect(git("branch", "--list", "feat/old").trim()).toBe("");
  });

  it("keeps a lane with uncommitted changes, commits of its own, or a live process, saying why", async () => {
    const dirty = await lane("dirty");
    fs.writeFileSync(path.join(dirty, "b.js"), "wip\n");
    const ahead = await lane("ahead");
    fs.writeFileSync(path.join(ahead, "c.js"), "work\n");
    execFileSync("git", ["-C", ahead, "add", "c.js"]);
    execFileSync("git", ["-C", ahead, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "work"]);
    const busy = await lane("busy");
    const r = await prune({}, { processes: { cwds: new Set([busy]), unseen: 0 } });
    expect(r.removed).toEqual([]);
    const why = Object.fromEntries(r.kept.map((l) => [l.slug, l.reasons.join("; ")]));
    expect(why.dirty).toMatch(/uncommitted/);
    expect(why.ahead).toMatch(/1 commit/);
    expect(why.busy).toMatch(/process/);
    for (const p of [dirty, ahead, busy]) expect(fs.existsSync(p)).toBe(true);
  });

  it("an ignored .env keeps the lane; ignored node_modules does not", async () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), ".env\nnode_modules/\n");
    git("add", ".gitignore"); git("commit", "-qm", "ignore");
    const nm = await lane("nm");
    fs.mkdirSync(path.join(nm, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(nm, "node_modules", "x.js"), "x\n");
    const env = await lane("env");
    fs.writeFileSync(path.join(env, ".env"), "SECRET=1\n");
    const r = await prune();
    expect(r.removed.map((l) => l.slug)).toEqual(["nm"]);
    expect(r.kept[0].reasons.join()).toMatch(/not regenerable \(\.env\)/);
  });

  it("a detached lane with commits of its own is kept", async () => {
    const p = await lane("det");
    execFileSync("git", ["-C", p, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "own"]);
    execFileSync("git", ["-C", p, "checkout", "-q", "--detach"]);
    expect((await prune()).kept.map((l) => [l.slug, l.reasons.join()])).toEqual([["det", "1 commit(s) not in main"]]);
  });

  it("without a way to see processes nothing is provably abandoned", async () => {
    const p = await lane("unknown");
    const r = await prune({}, { processes: null });
    expect(r.removed).toEqual([]);
    expect(r.kept[0].reasons.join(" ")).toMatch(/cannot check/);
    expect(fs.existsSync(p)).toBe(true);
  });

  it("with processes that cannot be inspected, only a lane idle for 24 h is abandoned", async () => {
    await lane("fresh");
    const hidden = { cwds: new Set(), unseen: 2 };
    expect((await prune({}, { processes: hidden })).kept[0].reasons.join()).toMatch(/cannot be inspected/);
    expect((await prune({}, { processes: hidden, now: Date.now() + 25 * 3_600_000 })).removed.map((l) => l.slug)).toEqual(["fresh"]);
  });

  it("--dry-run lists what it would retire and touches nothing", async () => {
    const p = await lane("old");
    const r = await prune({ dryRun: true });
    expect(r.wouldRemove.map((l) => l.slug)).toEqual(["old"]);
    expect(fs.existsSync(p)).toBe(true);
  });

  // KJC-TSK-1037: loose kj-hu-* branches (no worktree) from old runs.
  it("deletes a loose kj-hu-* branch with no commits of its own, keeps one with work and says how much", async () => {
    git("branch", "kj-hu-HU-001");
    git("checkout", "-q", "-b", "kj-hu-HU-002");
    fs.writeFileSync(path.join(dir, "b.js"), "y\n");
    git("add", "b.js"); git("commit", "-qm", "work");
    git("checkout", "-q", "main");
    const r = await prune();
    expect(r.branchesRemoved).toEqual(["kj-hu-HU-001"]);
    expect(r.branchesKept).toEqual([{ branch: "kj-hu-HU-002", reason: "1 commit(s) not in main" }]);
    expect(git("branch", "--list", "kj-hu-*").trim()).toBe("kj-hu-HU-002");
  });

  // HU-3092: the lane's own background indexer is not "a live process": it is stopped, then the lane goes.
  describe("a lane whose only live process is its background indexer", () => {
    const PID = 4242;
    const indexerLane = async (slug) => {
      const p = await lane(slug);
      fs.mkdirSync(path.join(p, ".karajan"), { recursive: true });
      fs.writeFileSync(path.join(p, ".karajan", "rag.db.bootstrap"), JSON.stringify({ pid: PID, at: Date.now(), command: "c" }));
      fs.writeFileSync(path.join(p, ".karajan", "rag.db"), "db");
      return p;
    };
    const procsIn = (...ps) => ({ cwds: new Set(ps.map((p) => p.cwd)), unseen: 0, procs: ps });
    const deps = (p, extra = {}) => { const calls = []; return { calls, deps: { processes: procsIn({ pid: PID, cwd: p }), stopIndexer: (l) => { calls.push({ slug: l.slug, existed: fs.existsSync(l.path) }); return { pid: PID }; }, ...extra } }; };

    it.each([["untracked", false], ["ignored", true]])("stops it once, while the lane exists, and retires the lane (.karajan %s)", async (_n, ignored) => {
      if (ignored) { fs.writeFileSync(path.join(dir, ".gitignore"), ".karajan/\n"); git("add", ".gitignore"); git("commit", "-qm", "ignore"); }
      const p = await indexerLane("idx");
      const { calls, deps: d } = deps(p);
      const r = await prune({}, d);
      expect(calls).toEqual([{ slug: "idx", existed: true }]);
      expect(r.removed.map((l) => l.slug)).toEqual(["idx"]);
      expect(fs.existsSync(p)).toBe(false);
    });

    it("keeps the lane when the stop fails and the indexer still runs", async () => {
      const p = await indexerLane("stuck");
      const r = await prune({}, deps(p, { stopIndexer: () => null, indexerRunning: () => true }).deps);
      expect(r.kept[0].reasons.join()).toMatch(/background index \(pid 4242\) could not be stopped/);
      expect(fs.existsSync(p)).toBe(true);
    });

    it("an expired marker (older than MAX_RUN_MS) naming a live pid whose stop fails still keeps the lane", async () => {
      const p = await indexerLane("expired");
      fs.writeFileSync(path.join(p, ".karajan", "rag.db.bootstrap"), JSON.stringify({ pid: process.pid, at: Date.now() - 2 * 3_600_000, command: "c" }));
      const r = await prune({}, deps(p, { processes: procsIn({ pid: process.pid, cwd: p }), stopIndexer: () => null }).deps);
      expect(r.kept[0].reasons.join()).toMatch(new RegExp(`pid ${process.pid}\\) could not be stopped`));
      expect(fs.existsSync(p)).toBe(true);
    });

    it("retires the lane when the stop fails but the pid is already gone", async () => {
      const p = await indexerLane("gone");
      expect((await prune({}, deps(p, { stopIndexer: () => null, indexerRunning: () => false }).deps)).removed.map((l) => l.slug)).toEqual(["gone"]);
    });

    it("another process in the lane keeps it, and nothing is stopped", async () => {
      const p = await indexerLane("shared");
      const { calls, deps: d } = deps(p, { processes: procsIn({ pid: PID, cwd: p }, { pid: 999, cwd: p }) });
      expect((await prune({}, d)).kept[0].reasons.join()).toMatch(/live process/);
      expect(calls).toEqual([]);
    });

    it("a dirty lane keeps its indexer running", async () => {
      const p = await indexerLane("dirty");
      fs.writeFileSync(path.join(p, "b.js"), "wip\n");
      const { calls, deps: d } = deps(p);
      expect((await prune({}, d)).kept[0].reasons.join()).toMatch(/uncommitted/);
      expect(calls).toEqual([]);
    });

    it("--dry-run stops nothing and says it would", async () => {
      const p = await indexerLane("dry");
      const { calls, deps: d } = deps(p);
      const out = [];
      const log = console.log; console.log = (l) => out.push(l);
      try { await prune({ dryRun: true }, d); } finally { console.log = log; }
      expect(calls).toEqual([]);
      expect(out).toContain("would retire dry (feat/dry) (stopping its background index, pid 4242)");
      expect(fs.existsSync(p)).toBe(true);
    });

    it("processes without pids (legacy injection) keep the lane as before", async () => {
      const p = await indexerLane("legacy");
      const { calls } = deps(p);
      expect((await prune({}, { processes: { cwds: new Set([p]), unseen: 0 }, stopIndexer: () => calls.push(1) })).kept[0].reasons.join()).toMatch(/live process/);
      expect(calls).toEqual([]);
    });

    it("with KJ_RAG_DB set the marker is not this lane's: kept, nothing stopped", async () => {
      const p = await indexerLane("env");
      const { calls, deps: d } = deps(p);
      process.env.KJ_RAG_DB = path.join(dir, "elsewhere.db");
      try { expect((await prune({}, d)).kept[0].reasons.join()).toMatch(/live process/); } finally { delete process.env.KJ_RAG_DB; }
      expect(calls).toEqual([]);
    });

    it("an ignored .karajan/ holding a symlink of the user's is not regenerable state", async () => {
      fs.writeFileSync(path.join(dir, ".gitignore"), ".karajan/\n"); git("add", ".gitignore"); git("commit", "-qm", "ignore");
      const p = await indexerLane("link");
      fs.symlinkSync("/etc/hosts", path.join(p, ".karajan", "notes-link"));
      const { calls, deps: d } = deps(p);
      expect((await prune({}, d)).kept[0].reasons.join()).toMatch(/not regenerable/);
      expect(calls).toEqual([]);
    });

    it("the indexer excluded, processes that cannot be inspected still protect a lane changed within 24 h", async () => {
      const p = await indexerLane("hidden");
      const { calls, deps: d } = deps(p, { processes: { ...procsIn({ pid: PID, cwd: p }), unseen: 1 } });
      expect((await prune({}, d)).kept[0].reasons.join()).toMatch(/cannot be inspected/);
      expect(calls).toEqual([]);
    });

    it("rag.db-wal and rag.db.embed-schema do not keep a lane, but any other .karajan file does", async () => {
      const a = await lane("wal");
      fs.mkdirSync(path.join(a, ".karajan"), { recursive: true });
      for (const f of ["rag.db-wal", "rag.db-shm", "rag.db.embed-schema"]) fs.writeFileSync(path.join(a, ".karajan", f), "x");
      const b = await lane("other");
      fs.mkdirSync(path.join(b, ".karajan"), { recursive: true });
      fs.writeFileSync(path.join(b, ".karajan", "other"), "x");
      const r = await prune();
      expect(r.removed.map((l) => l.slug)).toEqual(["wal"]);
      expect(r.kept.map((l) => l.slug)).toEqual(["other"]);
    });
  });

  it("measures against origin/<base> when it exists, not a lagging local base", async () => {
    git("checkout", "-q", "-b", "kj-hu-HU-003");
    fs.writeFileSync(path.join(dir, "c.js"), "z\n");
    git("add", "c.js"); git("commit", "-qm", "merged upstream");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "main");
    const r = await prune({ dryRun: true });
    expect(r.wouldRemoveBranches).toEqual(["kj-hu-HU-003"]);
    expect(git("branch", "--list", "kj-hu-*").trim()).toBe("kj-hu-HU-003");
  });
});
