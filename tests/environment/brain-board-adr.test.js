// AB-H (KJC-TSK-0658): the brain can honor "card first" and "check the
// ADRs" on any backend — HU writes without the subprocess planner, ADRs
// as numbered git-tracked markdown.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand, HU_STATUSES } from "../../src/commands/hu.js";
import { addAdr, listAdrs } from "../../src/environment/adr.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-abh-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const cfg = () => ({ projectDir: dir });

describe("kj hu", () => {
  it("add creates the brain-backlog plan and a pending HU visible in list", async () => {
    const added = await huCommand({ config: cfg(), action: "add", args: ["Login with magic link"], flags: { json: true, id: "AUTH-1" } });
    expect(added.status).toBe("pending");
    const rows = await huCommand({ config: cfg(), action: "list", flags: { json: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ short_id: "AUTH-1", title: "Login with magic link", status: "pending" });
  });

  it("move accepts short_id and validates statuses", async () => {
    await huCommand({ config: cfg(), action: "add", args: ["Thing"], flags: { json: true, id: "T-1" } });
    const moved = await huCommand({ config: cfg(), action: "move", args: ["T-1", "running"], flags: { json: true } });
    expect(moved.status).toBe("running");
    await expect(huCommand({ config: cfg(), action: "move", args: ["T-1", "flying"], flags: {} }))
      .rejects.toThrow(new RegExp(HU_STATUSES.join(", ")));
    await expect(huCommand({ config: cfg(), action: "move", args: ["NOPE", "done"], flags: {} }))
      .rejects.toThrow(/not found/);
  });

  it("move with an ambiguous ref across plans errors instead of guessing", async () => {
    const { savePlan } = await import("../../src/plan/plan-store.js");
    const { generatePlanId } = await import("../../src/plan/plan-id.js");
    await huCommand({ config: cfg(), action: "add", args: ["A"], flags: { json: true, id: "DUP-1" } });
    await savePlan(dir, {
      version: 2, planId: generatePlanId(), name: "other", task: "t", status: "ready",
      hus: [{ id: "hu_other_001", short_id: "DUP-1", title: "B", status: "pending" }],
      createdAt: new Date().toISOString(),
    });
    await expect(huCommand({ config: cfg(), action: "move", args: ["DUP-1", "done"], flags: {} }))
      .rejects.toThrow(/ambiguous/);
    // the full canonical id resolves even when a short_id collides with it
    const moved = await huCommand({ config: cfg(), action: "move", args: ["hu_other_001", "done"], flags: { json: true } });
    expect(moved.id).toBe("hu_other_001");
  });

  // KJC-TSK-0661 (Jorge's friction): every HU carries provenance — who
  // created it, when, from which plan — and the list surfaces it.
  it("add stamps created_by and list exposes provenance + next-action hint", async () => {
    await huCommand({ config: cfg(), action: "add", args: ["Traced"], flags: { json: true, id: "TR-1" } });
    const rows = await huCommand({ config: cfg(), action: "list", flags: { json: true } });
    expect(rows[0].plan).toBe("brain-backlog");
    expect(typeof rows[0].created_by).toBe("string");
    expect(rows[0].created_by.length).toBeGreaterThan(0);
    expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    await huCommand({ config: cfg(), action: "list", flags: {} });
    spy.mockRestore();
    const out = logs.join("\n");
    expect(out).toMatch(/brain-backlog · by \S+/);
    expect(out).toMatch(/kj hu move <id> skipped/);
  });

  // KJC-TSK-0669 (Jorge's dashboard fights): cards are permanent — the
  // delete-and-recreate "fix" is refused with the norm spelled out.
  it("add with an existing short_id refuses and teaches the norm", async () => {
    await huCommand({ config: cfg(), action: "add", args: ["First"], flags: { json: true, id: "DUP-9" } });
    await expect(huCommand({ config: cfg(), action: "add", args: ["Again"], flags: { json: true, id: "DUP-9" } }))
      .rejects.toThrow(/never deleted or recreated[\s\S]*kj hu move DUP-9/);
    const rows = await huCommand({ config: cfg(), action: "list", flags: { json: true } });
    expect(rows.filter((r) => r.short_id === "DUP-9")).toHaveLength(1);
  });

  // KJC-TSK-0675 (issue #1288): an agent that skips `kj hu list` must not
  // be able to create a twin of existing work — not even in ANOTHER plan
  // (Jorge's case: planner HUs + a second set under brain-backlog).
  it("add refuses an identical title, even when it lives in another plan", async () => {
    const { savePlan } = await import("../../src/plan/plan-store.js");
    const { generatePlanId } = await import("../../src/plan/plan-id.js");
    await savePlan(dir, {
      version: 2, planId: generatePlanId(), name: "toolgate-phase-1", task: "t", status: "ready",
      hus: [{ id: "hu_plan_002", short_id: "BB-002", title: "Wire the toolgate monorepo scanner", status: "pending" }],
      createdAt: new Date().toISOString(),
    });
    await expect(huCommand({ config: cfg(), action: "add", args: ["Wire the toolgate: monorepo scanner!"], flags: {} }))
      .rejects.toThrow(/already exists.*toolgate-phase-1|toolgate-phase-1.*already exists/s);
  });

  it("add warns (but creates) on a very similar title, listing the candidates", async () => {
    await huCommand({ config: cfg(), action: "add", args: ["Add retry logic to the webhook dispatcher"], flags: { json: true, id: "WH-1" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const added = await huCommand({ config: cfg(), action: "add", args: ["Add retry logic to webhook dispatcher queue"], flags: { json: true } });
      expect(added.status).toBe("pending");
      expect(warn.mock.calls.flat().join("\n")).toMatch(/WH-1/);
    } finally {
      warn.mockRestore();
    }
  });

  it("a skipped HU does not block reusing its title", async () => {
    await huCommand({ config: cfg(), action: "add", args: ["Rebuild the login form"], flags: { json: true, id: "L-1" } });
    await huCommand({ config: cfg(), action: "move", args: ["L-1", "skipped"], flags: { json: true } });
    const added = await huCommand({ config: cfg(), action: "add", args: ["Rebuild the login form"], flags: { json: true } });
    expect(added.status).toBe("pending");
  });

  it("second add reuses the same backlog plan", async () => {
    await huCommand({ config: cfg(), action: "add", args: ["A"], flags: { json: true } });
    await huCommand({ config: cfg(), action: "add", args: ["B"], flags: { json: true } });
    const rows = await huCommand({ config: cfg(), action: "list", flags: { json: true } });
    expect(new Set(rows.map((r) => r.plan)).size).toBe(1);
  });
});

describe("kj adr", () => {
  it("add creates numbered git-trackable markdown; list reads it back", async () => {
    const a = await addAdr(dir, { title: "Use SQLite for state", decision: "node:sqlite over external DBs", context: "single-machine tool" });
    expect(a.number).toBe(1);
    expect(a.file).toMatch(/^\.karajan\/adrs\/0001-use-sqlite-for-state\.md$/);
    const b = await addAdr(dir, { title: "Second", decision: "yes" });
    expect(b.number).toBe(2);
    const adrs = await listAdrs(dir);
    expect(adrs.map((x) => x.title)).toEqual(["Use SQLite for state", "Second"]);
    expect(fs.readFileSync(path.join(dir, a.file), "utf8")).toMatch(/## Decision/);
  });

  it("add without decision throws", async () => {
    await expect(addAdr(dir, { title: "X" })).rejects.toThrow(/--decision/);
  });
});
