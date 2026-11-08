// HU-3386 (epic #3332): the core drives any task manager. A fake in-memory manager whose ids are
// TRI-<n> goes through add, list, move, start, the offline queue and a claim held by someone else.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";
import { readCache } from "../../src/hu/team-board-cache.js";
import { boardKey } from "../../src/hu/board-key.js";
import { loadPlan } from "../../src/plan/plan-store.js";

let dir, prevHome;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-core-manager-"));
  prevHome = process.env.KARAJAN_HOME;
  process.env.KARAJAN_HOME = path.join(dir, ".karajan-home");
  fs.mkdirSync(process.env.KARAJAN_HOME, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
});

const named = (name, message) => Object.assign(new Error(message), { name });
const board = { backend: "linear", linear: { team: "TRI" } };

function fakeManager({ online = true, heldBy = null } = {}) {
  const rows = [{ short_id: "TRI-123", title: "Existing", status: "pending", claimed_by: null, ref: null }];
  const calls = [];
  const gate = async () => { if (!online) throw named("BoardOfflineError", "no network"); };
  const held = async (id, who) => { if (heldBy && heldBy !== who) throw named("HuClaimedError", `${id} is held by ${heldBy}`); };
  return {
    rows, calls,
    isId: (ref) => /^TRI-\d+$/i.test(ref),
    idHint: "TRI-<number>",
    list: async () => { await gate(); return rows.map((r) => ({ ...r })); },
    create: async (args) => { await gate(); const hu = { short_id: "TRI-124", title: args.title, status: "pending" }; rows.push({ ...hu, claimed_by: null }); return hu; },
    assertNotHeld: async (id, who) => { await gate(); await held(id, who); },
    write: {
      move: async (id, status) => { await gate(); calls.push(["move", id, status]); const r = rows.find((x) => x.short_id === id); if (r) r.status = status; },
      claim: async (id, who, opts) => { await gate(); await held(id, who); calls.push(["claim", id, who, Boolean(opts?.release)]); },
    },
  };
}
const hu = (action, args, manager, flags = {}, extra = {}) =>
  huCommand({ config: { projectDir: dir }, action, args, flags: { json: true, ...flags }, deps: { boardConfig: async () => board, manager, who: "ana", ...extra } });

describe("the core drives a manager whose ids are not HU-<n>", () => {
  it("adds, lists, moves and starts through the manager", async () => {
    const m = fakeManager();
    expect(await hu("add", ["A new card"], m)).toMatchObject({ short_id: "TRI-124", board: "linear" });
    const rows = await hu("list", [], m);
    expect(rows.map((r) => [r.id, r.plan])).toEqual([["TRI-123", "linear"], ["TRI-124", "linear"]]);
    expect(await hu("move", ["TRI-123", "running"], m)).toEqual({ id: "TRI-123", status: "running", claimed_by: "ana" });
    expect(m.calls).toEqual([["claim", "TRI-123", "ana", false], ["move", "TRI-123", "running"]]);
    const mirror = await loadPlan(dir, "linear");
    expect(mirror).toMatchObject({ planId: "plan-linear-tri-board", readonly: "linear" });
  });

  it("queues a move offline in the cache of its own board and replays it when the manager answers", async () => {
    const r = await hu("move", ["TRI-123", "running"], fakeManager({ online: false }));
    expect(r).toMatchObject({ id: "TRI-123", queued: true });
    expect(fs.existsSync(path.join(dir, ".karajan", "board-cache.json"))).toBe(false);
    expect(readCache(dir, boardKey(board).cacheFile).queue).toEqual([expect.objectContaining({ id: "TRI-123", status: "running" })]);
    const back = fakeManager();
    await hu("list", [], back);
    expect(back.calls).toEqual([["claim", "TRI-123", "ana", false], ["move", "TRI-123", "running"]]);
    expect(readCache(dir, boardKey(board).cacheFile).queue).toEqual([]);
  });

  it("serves the list from the cache when the manager is offline", async () => {
    await hu("list", [], fakeManager());
    const rows = await hu("list", [], fakeManager({ online: false }));
    expect(rows.map((r) => r.id)).toEqual(["TRI-123"]);
  });

  it("refuses a claim held by someone else, and a card of another board", async () => {
    await expect(hu("move", ["TRI-123", "running"], fakeManager({ heldBy: "bob" }))).rejects.toThrow(/held by bob/);
    await expect(hu("move", ["HU-7", "done"], fakeManager())).rejects.toThrow(/TRI-<number>/);
  });

  it("start reads the card from the manager, opens the lane and claims it", async () => {
    const m = fakeManager();
    const worktree = vi.fn(async () => ({ branch: "feat/TRI-123-existing", path: "/lane" }));
    expect(await hu("start", ["TRI-123"], m, {}, { worktree, lanes: async () => [] })).toMatchObject({ id: "TRI-123", branch: "feat/TRI-123-existing" });
    expect(worktree).toHaveBeenCalledWith(expect.objectContaining({ args: ["TRI-123-existing"] }));
    expect(m.calls).toEqual([["claim", "TRI-123", "ana", false], ["move", "TRI-123", "running"]]);
    await expect(hu("start", ["TRI-123"], fakeManager({ heldBy: "bob" }), {}, { worktree, lanes: async () => [] })).rejects.toThrow(/held by bob/);
  });
});

describe("the key of a board", () => {
  it("keeps GitHub's cache file and mirror plan, and derives the others from backend and team", () => {
    expect(boardKey({ backend: "github", repo: "acme/app" })).toMatchObject({ cacheFile: ".karajan/board-cache.json", planId: "plan-github-board", name: "github" });
    expect(boardKey(board)).toMatchObject({ cacheFile: ".karajan/board-cache-linear-tri.json", planId: "plan-linear-tri-board", name: "linear" });
    expect(boardKey({ backend: "linear", linear: { team: "../../Evil Team" } }).cacheFile).toBe(".karajan/board-cache-linear-evil-team.json");
  });
});
