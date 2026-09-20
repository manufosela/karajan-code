// KJC-BUG-0189 — the card-first gate blocks an edit and tells the agent to run
// `kj hu add`, but without --id the HU used to get only the canonical plan id
// (hu_plan-<stamp>-<rand>_001), which CARD_REF_RE rejects: the branch named
// after the card the gate demanded failed that same gate.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";
import { CARD_REF_RE } from "../../src/review/card-first.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-huref-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const cfg = () => ({ projectDir: dir });
const add = (title, flags = {}) => huCommand({ config: cfg(), action: "add", args: [title], flags: { json: true, ...flags } });

describe("kj hu add × card-first", () => {
  it("gives every HU a reference the card-first gate accepts", async () => {
    const hu = await add("Login with magic link");
    expect(hu.short_id).toMatch(CARD_REF_RE);
    expect(`feat/${hu.short_id}-login`).toMatch(CARD_REF_RE);
  });

  it("numbers them in sequence without colliding", async () => {
    const first = await add("Primera");
    const second = await add("Segunda");
    expect(second.short_id).not.toBe(first.short_id);
    expect(second.short_id).toMatch(CARD_REF_RE);
  });

  it("an explicit --id still wins", async () => {
    const hu = await add("Con id propio", { id: "AUTH-1" });
    expect(hu.short_id).toBe("AUTH-1");
  });
});
