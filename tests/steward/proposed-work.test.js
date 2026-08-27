// STW-D (KJC-TSK-0792, epic KJC-PCS-0081) — every break is PROPOSED work:
// a card with evidence and a remedy plan to review before executing, without
// duplicating and without flooding the board. Real HU Board on disk, no mocks.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncProposedWork } from "../../src/steward/proposed-work.js";
import { listPlans, loadPlan } from "../../src/plan/plan-store.js";

let dir;
const broken = (id, evidence = "it broke") => ({ id, verdict: "broken", evidence, remedy: "fix it", renew: "kj steward sweep" });
const ok = (id) => ({ id, verdict: "ok", evidence: "green again" });
const config = () => ({ projectDir: dir, state_backend: "hu-board" });
const allHus = async () => {
  const plans = await listPlans(dir);
  const out = [];
  for (const p of plans) out.push(...((await loadPlan(dir, p.planId)).hus || []));
  return out;
};

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-stw-work-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("syncProposedWork", () => {
  it("a first-time break becomes a card: evidence, since-when, and a remedy PLAN marked as proposal not to execute unreviewed", async () => {
    const r = await syncProposedWork({ projectDir: dir, config: config(), results: [broken("main-ci", "red for 9 days")], sweptAt: "2026-08-27T12:00:00Z" });
    expect(r).toMatchObject({ synced: true, created: 1, updated: 0, resolved: 0 });
    const hus = await allHus();
    expect(hus).toHaveLength(1);
    expect(hus[0].title).toMatch(/main-ci/);
    expect(hus[0].scope).toMatch(/red for 9 days/);
    expect(hus[0].scope).toMatch(/2026-08-27/); // since when
    expect(hus[0].scope).toMatch(/review before executing/i); // AC2: stated on the card
    const map = JSON.parse(fs.readFileSync(path.join(dir, ".karajan", "steward", "cards.json"), "utf8"));
    expect(map["main-ci"].huId).toBe(hus[0].id);
  });

  it("the same break on successive sweeps updates the existing card and keeps since-when — never a twin", async () => {
    await syncProposedWork({ projectDir: dir, config: config(), results: [broken("main-ci")], sweptAt: "2026-08-20T00:00:00Z" });
    const r = await syncProposedWork({ projectDir: dir, config: config(), results: [broken("main-ci", "still red")], sweptAt: "2026-08-27T00:00:00Z" });
    expect(r).toMatchObject({ created: 0, updated: 1 });
    const hus = await allHus();
    expect(hus).toHaveLength(1);
    expect(hus[0].scope).toMatch(/2026-08-20/); // brokenSince survives
    expect(hus[0].scope).toMatch(/still red/);
  });

  it("back to green: the card resolves with the green evidence and the mapping forgets it", async () => {
    await syncProposedWork({ projectDir: dir, config: config(), results: [broken("main-ci")], sweptAt: "2026-08-20T00:00:00Z" });
    const r = await syncProposedWork({ projectDir: dir, config: config(), results: [ok("main-ci")], sweptAt: "2026-08-27T00:00:00Z" });
    expect(r).toMatchObject({ resolved: 1 });
    const hus = await allHus();
    expect(hus[0].status).toBe("done");
    const map = JSON.parse(fs.readFileSync(path.join(dir, ".karajan", "steward", "cards.json"), "utf8"));
    expect(map["main-ci"]).toBeUndefined();
  });

  it("a board kj does not own (planning-game/external) is never mirrored: synced false, said with its reason", async () => {
    const r = await syncProposedWork({ projectDir: dir, config: { projectDir: dir, state_backend: "planning-game" }, results: [broken("main-ci")], sweptAt: "2026-08-27T00:00:00Z" });
    expect(r.synced).toBe(false);
    expect(r.reason).toMatch(/planning-game/);
    expect(await allHus()).toHaveLength(0);
  });
});
