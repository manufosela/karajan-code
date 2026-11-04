// HU-3345 (epic #3332, ADR 0029): the board id is opaque to the core. A manager whose ids are not
// HU-<n> (here TRI-123) moves, claims, queues offline and replays; the id format comes from it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";
import { findBoardHu } from "../../src/hu/board-lookup.js";
import { readCache } from "../../src/hu/team-board-cache.js";
import { createGithubManager } from "../../src/hu/managers/github/index.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-opaque-id-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const offlineError = () => Object.assign(new Error("dial tcp: no such host"), { name: "BoardOfflineError" });
const CARD = { short_id: "TRI-123", title: "Linear card", status: "pending", claimed_by: null, ref: null };
const triManager = ({ online = true, rows = [CARD], calls = [] } = {}) => {
  const gate = async () => { if (!online) throw offlineError(); };
  return {
    calls,
    isId: (ref) => /^TRI-\d+$/i.test(ref),
    idHint: "TRI-<number>",
    list: async () => { await gate(); return rows; },
    assertNotHeld: async () => gate(),
    write: {
      move: async (id, status) => { await gate(); calls.push(["move", id, status]); },
      claim: async (id, who, opts) => { await gate(); calls.push(["claim", id, who, Boolean(opts?.release)]); },
    },
  };
};
const hu = (action, args, deps, flags = {}) => huCommand({ config: { projectDir: dir }, action, args, flags: { json: true, ...flags }, deps: { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), who: "manufosela", ...deps } });

describe("a manager whose ids are not HU-<n>", () => {
  it("moves and claims TRI-123, and refuses an id that is not its own", async () => {
    const manager = triManager();
    expect(await hu("move", ["TRI-123", "running"], { manager })).toEqual({ id: "TRI-123", status: "running", claimed_by: "manufosela" });
    expect(manager.calls).toEqual([["claim", "TRI-123", "manufosela", false], ["move", "TRI-123", "running"]]);
    await expect(hu("move", ["HU-7", "done"], { manager })).rejects.toThrow(/TRI-<number>/);
  });

  it("queues the move offline under its own id and replays it when the board answers", async () => {
    const r = await hu("move", ["TRI-123", "running"], { manager: triManager({ online: false }) });
    expect(r).toMatchObject({ id: "TRI-123", status: "running", queued: true });
    expect(readCache(dir).queue).toEqual([expect.objectContaining({ id: "TRI-123", status: "running" })]);
    const back = triManager();
    await hu("list", [], { manager: back });
    expect(back.calls).toEqual([["claim", "TRI-123", "manufosela", false], ["move", "TRI-123", "running"]]);
    expect(readCache(dir).queue).toEqual([]);
  });

  it("finds the card of the board by its id", async () => {
    const found = await findBoardHu(dir, "TRI-123", { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), manager: triManager(), pinGhIdentity: () => {}, listPlans: async () => [] });
    expect(found).toMatchObject({ short_id: "TRI-123" });
  });
});

describe("the queue written by an older kj", () => {
  it("replays an entry stored with `number` as HU-<number>", async () => {
    fs.mkdirSync(path.join(dir, ".karajan"));
    fs.writeFileSync(path.join(dir, ".karajan", "board-cache.json"), JSON.stringify({ hus: null, updatedAt: null, queue: [{ number: 7, status: "done", who: "manufosela", release: false, expected: null, queuedAt: "2026-01-01T00:00:00Z" }] }));
    const applied = [];
    const deps = { listTeamHus: async () => [], assertNotHeld: async () => {}, setTeamStatus: async (a) => applied.push(a.number) };
    await hu("list", [], deps);
    expect(applied).toEqual([7]);
    expect(readCache(dir).queue).toEqual([]);
  });
});

describe("the GitHub manager's id format", () => {
  it("accepts HU-<n> and #<n>, canonical HU-<n>, and nothing else", () => {
    const m = createGithubManager({ repo: "acme/app" });
    expect(["HU-7", "hu-7", "#7", "TRI-7", "HU-0007", "T-1"].map(m.isId)).toEqual([true, true, true, false, false, false]);
    expect(m.canonicalId("#7")).toBe("HU-7");
    expect(m.idHint).toMatch(/HU-<issue number>/);
  });
});
