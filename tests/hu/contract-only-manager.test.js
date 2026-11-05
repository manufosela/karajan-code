// HU-3394 (epic #3332): the core drives a manager that implements only the contract
// (create, list, move, claim): `write` and `assertNotHeld` are optional optimisations.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";
import { readCache } from "../../src/hu/team-board-cache.js";
import { boardKey } from "../../src/hu/board-key.js";
import { createTemplateManager } from "../../packages/story-contract/template/src/manager.js";
import { withManagerDefaults } from "../../src/hu/manager-ops.js";

let dir, prevHome;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-contract-manager-"));
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

const board = { backend: "linear", linear: { team: "TRI" } };

/** Only create, list, move, claim: no `write`, no `assertNotHeld`. */
function contractOnly({ online = true, status = "pending", claimedBy = null } = {}) {
  const rows = [{ short_id: "TRI-123", title: "Existing", status, claimed_by: claimedBy, ref: null }];
  const calls = [];
  const gate = () => { if (!online) throw Object.assign(new Error("no network"), { name: "BoardOfflineError" }); };
  const listed = vi.fn();
  return {
    calls, listed,
    isId: (ref) => /^TRI-\d+$/i.test(ref),
    idHint: "TRI-<number>",
    list: async () => { gate(); listed(); return rows.map((r) => ({ ...r })); },
    create: async (args) => { gate(); const created = { short_id: "TRI-124", title: args.title, status: "pending" }; rows.push({ ...created, claimed_by: null }); return created; },
    move: async (id, to) => { gate(); calls.push(["move", id, to]); const r = rows.find((x) => x.short_id === id); if (r) r.status = to; return { short_id: id, status: to }; },
    claim: async (id, who, opts) => { gate(); calls.push(["claim", id, who, Boolean(opts?.release)]); return { short_id: id, claimed_by: who }; },
  };
}
const hu = (action, args, manager, flags = {}, extra = {}) =>
  huCommand({ config: { projectDir: dir }, action, args, flags: { json: true, ...flags }, deps: { boardConfig: async () => board, manager, who: "ana", ...extra } });

describe("the core with a contract-only manager", () => {
  it("adds, lists, moves and starts through the contract operations", async () => {
    const m = contractOnly();
    expect(await hu("add", ["A new card"], m)).toMatchObject({ short_id: "TRI-124" });
    expect((await hu("list", [], m)).map((r) => r.id)).toEqual(["TRI-123", "TRI-124"]);
    expect(await hu("move", ["TRI-123", "running"], m)).toEqual({ id: "TRI-123", status: "running", claimed_by: "ana" });
    expect(m.calls).toEqual([["claim", "TRI-123", "ana", false], ["move", "TRI-123", "running"]]);
    const worktree = async () => ({ branch: "feat/TRI-123-existing", path: "/lane" });
    expect(await hu("start", ["TRI-123"], contractOnly(), {}, { worktree })).toMatchObject({ id: "TRI-123" });
  });

  it("replays the offline queue", async () => {
    expect(await hu("move", ["TRI-123", "running"], contractOnly({ online: false }))).toMatchObject({ queued: true });
    const back = contractOnly();
    await hu("list", [], back);
    expect(back.calls).toEqual([["claim", "TRI-123", "ana", false], ["move", "TRI-123", "running"]]);
    expect(readCache(dir, boardKey(board).cacheFile).queue).toEqual([]);
  });

  it("refuses to move a running card held by someone else, with the held error", async () => {
    const m = contractOnly({ status: "running", claimedBy: "bob" });
    const err = await hu("move", ["TRI-123", "done"], m).catch((e) => e);
    expect(err).toMatchObject({ name: "HuClaimedError", message: "TRI-123 is held by bob: taking it over is explicit (release)" });
    expect(m.calls).toEqual([]);
    await hu("move", ["TRI-123", "done"], m, { release: true });
    expect(m.calls).toEqual([["claim", "TRI-123", "ana", true], ["move", "TRI-123", "done"]]);
  });

  describe("HU-3420: an identity the board cannot resolve", () => {
    const hint = `no Linear user mapped for ana: add it to linear.users: { "ana": "<linear email>" }`;
    const unmapped = (opts) => Object.assign(contractOnly(opts), { claim: async () => { throw Object.assign(new Error(hint), { name: "BoardRejectedError", code: "UNMAPPED_IDENTITY" }); } });

    it("still moves the card to running, unassigned, and says why with the line to add", async () => {
      const m = unmapped();
      const warning = `TRI-123 was not assigned: ${hint}`;
      expect(await hu("move", ["TRI-123", "running"], m)).toEqual({ id: "TRI-123", status: "running", claimed_by: null, warning });
      expect(m.calls).toEqual([["move", "TRI-123", "running"]]);
      await hu("move", ["TRI-123", "running"], unmapped(), { json: false });
      expect(console.log).toHaveBeenLastCalledWith(`✓ TRI-123 → running\n⚠ ${warning}`);
    });

    it("still refuses a card someone else runs, and an explicit release fails loud", async () => {
      await expect(hu("move", ["TRI-123", "running"], unmapped({ status: "running", claimedBy: "bob" }))).rejects.toMatchObject({ name: "HuClaimedError" });
      const m = unmapped();
      await expect(hu("move", ["TRI-123", "done"], m, { release: true })).rejects.toThrow(hint);
      expect(m.calls).toEqual([]);
    });
  });

  it("lets the holder, or any move of a card nobody runs, through (one list for the check)", async () => {
    const own = contractOnly({ status: "running", claimedBy: "ana" });
    await hu("move", ["TRI-123", "done"], own);
    expect(own.calls).toEqual([["move", "TRI-123", "done"]]);
    expect(own.listed).toHaveBeenCalledTimes(1);
  });
});

describe("the template manager without its write and assertNotHeld", () => {
  it("works through the core", async () => {
    const stories = [{ id: "T-1", title: "Existing", ref: null, labels: ["running"], holder: "bob" }];
    const client = {
      all: async () => stories.map((s) => ({ ...s })),
      get: async (id) => ({ ...stories.find((s) => s.id === id) }),
      insert: async () => ({}),
      setStatus: async (id, status) => { stories.find((s) => s.id === id).labels = [status]; },
      setHolder: async (id, who) => { stories.find((s) => s.id === id).holder = who; },
    };
    const { write: _write, assertNotHeld: _held, ...manager } = createTemplateManager({ client });
    const m = { ...manager, isId: (ref) => /^T-\d+$/.test(ref) };
    await expect(hu("move", ["T-1", "done"], m)).rejects.toMatchObject({ name: "HuClaimedError" });
    await hu("move", ["T-1", "done"], m, { release: true });
    expect(stories[0]).toMatchObject({ labels: ["done"], holder: "ana" });
  });
});

describe("withManagerDefaults", () => {
  it("keeps the write and assertNotHeld a manager brings", () => {
    const write = { move: vi.fn(), claim: vi.fn() };
    const assertNotHeld = vi.fn();
    const m = withManagerDefaults({ ...contractOnly(), write, assertNotHeld });
    expect(m.write).toBe(write);
    expect(m.assertNotHeld).toBe(assertNotHeld);
  });
});
