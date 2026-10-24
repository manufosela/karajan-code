// KJC-TSK-1165 (TEAM-GH-D, ADR 0025): without network the shared board answers from its local
// copy and queues the moves; the queue is applied when GitHub answers again, conflicts are
// reported and never overwrite, and creating a HU offline is refused (never a local id).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listWithCache, queueMove, flushQueue, readCache } from "../../src/hu/team-board-cache.js";
import { BoardOfflineError, HuClaimedError } from "../../src/hu/github-board.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-cache-")); fs.mkdirSync(path.join(dir, ".karajan")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const HUS = [{ short_id: "HU-7", number: 7, title: "A", status: "pending", claimed_by: null }];
const offline = async () => { throw new BoardOfflineError("dial tcp: no such host"); };

describe("listWithCache", () => {
  it("refreshes the local copy when GitHub answers, and serves it when GitHub does not", async () => {
    const online = await listWithCache({ projectDir: dir, repo: "acme/app", list: async () => HUS });
    expect(online).toMatchObject({ source: "github", rows: HUS });
    expect(readCache(dir).hus).toEqual(HUS);
    const cached = await listWithCache({ projectDir: dir, repo: "acme/app", list: offline });
    expect(cached).toMatchObject({ source: "cache", rows: HUS });
    expect(cached.updatedAt).toMatch(/^\d{4}-/);
  });

  it("with no network and no copy, the offline error surfaces", async () => {
    await expect(listWithCache({ projectDir: dir, repo: "acme/app", list: offline })).rejects.toBeInstanceOf(BoardOfflineError);
  });
});

describe("queueMove and flushQueue", () => {
  it("queues a move offline and applies it in order when the network is back", async () => {
    queueMove({ projectDir: dir, number: 7, status: "running", who: "manufosela", release: false });
    queueMove({ projectDir: dir, number: 7, status: "done", who: "manufosela", release: false });
    expect(readCache(dir).queue).toHaveLength(2);
    const applied = [];
    const r = await flushQueue({ projectDir: dir, apply: async (op) => applied.push(`${op.number}:${op.status}`) });
    expect(applied).toEqual(["7:running", "7:done"]);
    expect(r).toEqual({ applied: 2, conflicts: [], pending: 0 });
    expect(readCache(dir).queue).toEqual([]);
  });

  it("a conflict (someone else holds it) is reported and dropped; still offline, the rest stays queued", async () => {
    queueMove({ projectDir: dir, number: 7, status: "running", who: "manufosela", release: false });
    queueMove({ projectDir: dir, number: 8, status: "done", who: "manufosela", release: false });
    const apply = async (op) => { if (op.number === 7) throw new HuClaimedError("HU-7 is held by jorgecasar"); throw new BoardOfflineError("no such host"); };
    const r = await flushQueue({ projectDir: dir, apply });
    expect(r.conflicts).toEqual([expect.stringMatching(/HU-7.*held by jorgecasar/)]);
    expect(r).toMatchObject({ applied: 0, pending: 1 });
    expect(readCache(dir).queue.map((o) => o.number)).toEqual([8]);
  });

  it("an error that is neither offline nor a refusal surfaces, and the move stays queued", async () => {
    queueMove({ projectDir: dir, number: 9, status: "done", who: "manufosela", release: false });
    await expect(flushQueue({ projectDir: dir, apply: async () => { throw new TypeError("gh output was not JSON"); } })).rejects.toThrow(/not JSON/);
    expect(readCache(dir).queue.map((o) => o.number)).toEqual([9]);
  });
});
