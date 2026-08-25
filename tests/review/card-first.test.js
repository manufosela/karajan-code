// KJC-TSK-0686 (MG-A, épica KJC-PCS-0068) — card-first stops being a
// narratable habit: with hu-board, the branch must reference a LIVE card
// or the commit does not enter; external boards get a presence check.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCardFirst, CARD_REF_RE } from "../../src/review/card-first.js";
import { savePlan } from "../../src/plan/plan-store.js";
import { generatePlanId } from "../../src/plan/plan-id.js";

let dir;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-cf-"));
  await savePlan(dir, {
    version: 2, planId: generatePlanId(), name: "backlog", task: "t", status: "ready",
    createdAt: new Date().toISOString(),
    hus: [
      { id: "hu_p_001", short_id: "BB-002", title: "Viva", status: "running" },
      { id: "hu_p_002", short_id: "OLD-9", title: "Cerrada", status: "done" },
    ],
  });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const hu = (branch, cfg = {}) => checkCardFirst({ config: cfg, projectDir: dir, branch, env: {} });

describe("checkCardFirst — hu-board (verifiable, blocks by default)", () => {
  it("passes when the branch references a LIVE card", async () => {
    expect(await hu("feat/BB-002-cosa")).toMatchObject({ ok: true, ref: "BB-002" });
    expect((await hu("feat/bb-002-cosa")).ok).toBe(true); // case-insensitive
  });

  it("does not accept a live card as substring of a DIFFERENT reference (BB-002 vs BB-0022)", async () => {
    expect(await hu("feat/BB-0022-otra-cosa")).toMatchObject({ ok: false, mode: "block" });
  });

  it("a branch referencing a closed AND a live card passes on the live one", async () => {
    expect(await hu("feat/OLD-9-continuado-en-BB-002")).toMatchObject({ ok: true, ref: "BB-002" });
  });

  it("blocks when the branch references nothing, or only a closed card", async () => {
    expect(await hu("feat/mejora-suelta")).toMatchObject({ ok: false, mode: "block" });
    const closed = await hu("feat/OLD-9-retomar");
    expect(closed.ok).toBe(false);
    expect(closed.reason).toMatch(/OLD-9|live|kj hu/i);
  });

  it("policy can be relaxed to warn via method_gates.card_first", async () => {
    const r = await hu("feat/sin-card", { method_gates: { card_first: "warn" } });
    expect(r).toMatchObject({ ok: true, mode: "warn" });
  });
});

describe("checkCardFirst — external / planning-game (presence check, warns by default)", () => {
  const ext = { state_backend: "external", board: { name: "Linear" } };

  it("passes on a card-shaped reference in the branch", async () => {
    expect(await checkCardFirst({ config: ext, projectDir: dir, branch: "jorge/lin-123-fix", env: {} }))
      .toMatchObject({ ok: true });
  });

  it("warns (not blocks) by default without a reference; block via config", async () => {
    const w = await checkCardFirst({ config: ext, projectDir: dir, branch: "feat/cosas", env: {} });
    expect(w).toMatchObject({ ok: true, mode: "warn" });
    const b = await checkCardFirst({
      config: { ...ext, method_gates: { card_first: "block" } },
      projectDir: dir, branch: "feat/cosas", env: {},
    });
    expect(b).toMatchObject({ ok: false, mode: "block" });
  });

  // KJC-TSK-0732 (issue #1371): with board.verify_cmd the gate checks the
  // card is ALIVE in the real tracker — a dead/invented ref gets the same
  // treatment as "no card"; unverifiable degrades to branch-ref, saying so.
  describe("with board.verify_cmd (tracker verification)", () => {
    const cfg = { ...ext, board: { name: "Linear", verify_cmd: "adapter {ref}" } };
    const verify = (result) => ({ verifyFn: async () => result });

    it("a live card passes at tracker level", async () => {
      const r = await checkCardFirst({
        config: cfg, projectDir: dir, branch: "jorge/lin-123-fix", env: {},
        deps: verify({ level: "tracker", verified: true, status: "In Progress" }),
      });
      expect(r).toMatchObject({ ok: true, mode: "pass", ref: "lin-123", level: "tracker" });
    });

    it("a dead or invented ref is treated like 'no card' (warn by default, block via config)", async () => {
      const dead = verify({ level: "tracker", verified: false, status: "Done" });
      const w = await checkCardFirst({ config: cfg, projectDir: dir, branch: "jorge/lin-123-fix", env: {}, deps: dead });
      expect(w).toMatchObject({ ok: true, mode: "warn" });
      expect(w.reason).toContain("Done");
      const b = await checkCardFirst({
        config: { ...cfg, method_gates: { card_first: "block" } },
        projectDir: dir, branch: "jorge/lin-123-fix", env: {}, deps: dead,
      });
      expect(b).toMatchObject({ ok: false, mode: "block" });
    });

    it("unverifiable passes at branch-ref level WITH the degradation note", async () => {
      const r = await checkCardFirst({
        config: cfg, projectDir: dir, branch: "jorge/lin-123-fix", env: {},
        deps: verify({ level: "branch-ref", verified: null, note: "tracker verification degraded to branch-ref (ETIMEDOUT)" }),
      });
      expect(r).toMatchObject({ ok: true, mode: "pass", level: "branch-ref" });
      expect(r.note).toMatch(/degraded/);
    });
  });
});

describe("CARD_REF_RE — a version tail is not a card (KJC-BUG-0154)", () => {
  // `chore/release-4.22.0` matched "release-4" at the dot's word boundary, and the
  // board-sync gate then demanded moving a card that exists nowhere. Lived through it.
  it("does not read release-4.22.0 as the card RELEASE-4, and still reads real cards", () => {
    expect(CARD_REF_RE.test("chore/release-4.22.0")).toBe(false);
    expect(CARD_REF_RE.test("release-10.0.1")).toBe(false);
    expect("feat/KJC-TSK-0778-console-c2".match(CARD_REF_RE)[0]).toBe("KJC-TSK-0778");
    expect("fix/bb-002-thing".match(CARD_REF_RE)[0]).toBe("bb-002");
    expect("lin-123".match(CARD_REF_RE)[0]).toBe("lin-123");
  });
});

describe("checkCardFirst — exemptions", () => {
  it("release branches and the base branch are exempt; KJ_ALLOW_NO_CARD=1 is the escape hatch", async () => {
    for (const branch of ["chore/release-v4.6.0", "main", "master"]) {
      expect(await hu(branch)).toMatchObject({ ok: true, mode: "exempt" });
    }
    const r = await checkCardFirst({ config: {}, projectDir: dir, branch: "feat/sin-card", env: { KJ_ALLOW_NO_CARD: "1" } });
    expect(r).toMatchObject({ ok: true, mode: "exempt" });
  });
});
