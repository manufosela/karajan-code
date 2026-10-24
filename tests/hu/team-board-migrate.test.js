// KJC-TSK-1166 (TEAM-GH-E, ADR 0025): the HUs a person created before the shared board are
// moved to it once: an issue per live local HU, its status and its old id kept, idempotent.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-migrate-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const local = { boardConfig: async () => ({ backend: "local" }) };
const hu = (action, args, flags, deps) => huCommand({ config: { projectDir: dir }, action, args, flags: { json: true, ...flags }, deps });

function team() {
  const created = [];
  const moves = [];
  let next = 100;
  return {
    created, moves,
    deps: {
      boardConfig: async () => ({ backend: "github", repo: "acme/app" }),
      who: "manufosela",
      listTeamHus: async () => [],
      createTeamHu: async (a) => { created.push(a); next += 1; return { short_id: `HU-${next}`, number: next, status: "pending", title: a.title }; },
      claimTeamHu: async (a) => moves.push(["claim", a.number]),
      assertNotHeld: async () => {},
      setTeamStatus: async (a) => moves.push([a.status, a.number]),
    },
  };
}

describe("kj hu migrate --to github", () => {
  beforeEach(async () => {
    await hu("add", ["Old pending work"], { id: "HU-0001", ac: ["it works"], ref: "KJC-TSK-1" }, local);
    await hu("add", ["Old running work"], { id: "HU-0002" }, local);
    await hu("move", ["HU-0002", "running"], {}, { ...local, who: "manufosela" });
    await hu("add", ["Old done work"], { id: "HU-0003" }, local);
    await hu("move", ["HU-0003", "done"], {}, { ...local, who: "manufosela" });
  });

  it("creates one issue per live local HU, keeps its status and old id, and skips the finished ones", async () => {
    const { created, moves, deps } = team();
    const r = await hu("migrate", [], { to: "github" }, deps);
    expect(created.map((c) => [c.title, c.ref, c.acceptanceCriteria])).toEqual([
      ["Old pending work", "KJC-TSK-1 · was HU-0001", ["it works"]],
      ["Old running work", "was HU-0002", []],
    ]);
    expect(moves).toEqual([["claim", 102], ["running", 102]]);
    expect(r).toMatchObject({ migrated: [{ from: "HU-0001", to: "HU-101" }, { from: "HU-0002", to: "HU-102" }], skipped: ["HU-0003"] });
  });

  it("is idempotent: a second run migrates nothing, and --dry-run only tells", async () => {
    const first = team();
    const dry = await hu("migrate", [], { to: "github", dryRun: true }, first.deps);
    expect(dry.migrated).toHaveLength(2);
    expect(first.created).toHaveLength(0);
    await hu("migrate", [], { to: "github" }, first.deps);
    const second = team();
    const r = await hu("migrate", [], { to: "github" }, second.deps);
    expect(second.created).toHaveLength(0);
    expect(r.migrated).toEqual([]);
    // The local cards now point at their issues and stay out of the live list.
    const rows = await hu("list", [], {}, local);
    expect(rows.find((h) => h.short_id === "HU-0001")).toMatchObject({ status: "skipped", external_ref: expect.stringContaining("HU-101") });
  });

  it("a failure half-way keeps what was moved: the retry creates no issue twice", async () => {
    const t = team();
    let calls = 0;
    const flaky = { ...t.deps, createTeamHu: async (a) => { calls += 1; if (calls === 2) throw new Error("HTTP 502"); return t.deps.createTeamHu(a); } };
    await expect(hu("migrate", [], { to: "github" }, flaky)).rejects.toThrow(/502/);
    expect(t.created.map((c) => c.title)).toEqual(["Old pending work"]);
    const retry = team();
    const r = await hu("migrate", [], { to: "github" }, retry.deps);
    expect(retry.created.map((c) => c.title)).toEqual(["Old running work"]);
    expect(r.skipped).toContain("HU-0001");
  });

  it("a running HU whose claim failed keeps its issue and gets claimed and moved on the retry", async () => {
    const t = team();
    const failing = { ...t.deps, claimTeamHu: async () => { throw new Error("HTTP 502"); } };
    await expect(hu("migrate", [], { to: "github" }, failing)).rejects.toThrow(/502/);
    expect(t.created.map((c) => c.title)).toEqual(["Old pending work", "Old running work"]);
    const retry = team();
    const r = await hu("migrate", [], { to: "github" }, retry.deps);
    expect(retry.created).toHaveLength(0);
    expect(retry.moves).toEqual([["claim", 102], ["running", 102]]);
    expect(r.migrated).toEqual([{ from: "HU-0002", to: "HU-102", status: "running" }]);
    const rows = await hu("list", [], {}, local);
    expect(rows.find((h) => h.short_id === "HU-0002").status).toBe("skipped");
  });

  it("needs the shared board on, and a backend it knows", async () => {
    await expect(hu("migrate", [], { to: "github" }, local)).rejects.toThrow(/kj hu backend github/);
    await expect(hu("migrate", [], { to: "jira" }, team().deps)).rejects.toThrow(/--to github/);
  });
});
