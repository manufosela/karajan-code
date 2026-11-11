// KJL-TSK-0161 (ADR 0052): the replay shortens the recorded waits and shifts the state's dates.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_WAIT_MS, asNow, shifted, timeline } from "../../apps/landing/public/factory/replay-timeline.js";

const ev = (at) => ({ at, kind: "x" });
const T0 = "2026-11-11T10:00:00.000Z";

describe("timeline", () => {
  it("caps a long gap, keeps a short one, first at 0, order kept", () => {
    const events = [ev(T0), ev("2026-11-11T10:00:01.000Z"), ev("2026-11-11T11:00:00.000Z")];
    const result = timeline(events);
    expect(result.map((r) => r.ms)).toEqual([0, 1000, 1000 + MAX_WAIT_MS]);
    expect(result.map((r) => r.event)).toEqual(events);
  });
  it("returns [] for no events and honours a custom maxWait", () => {
    expect(timeline([])).toEqual([]);
    expect(timeline([ev(T0), ev("2026-11-11T10:05:00.000Z")], 100)[1].ms).toBe(100);
  });
  it("works on the real demo", () => {
    const path = new URL("../../apps/landing/public/factory/demo-hu-3870.json", import.meta.url);
    const demo = JSON.parse(readFileSync(path, "utf8"));
    const result = timeline(demo.events);
    const waits = result.slice(1).map((r, i) => r.ms - result[i].ms);
    expect(waits.every((w) => w <= MAX_WAIT_MS)).toBe(true);
    expect(result.at(-1).ms).toBeLessThan((Date.parse(demo.to) - Date.parse(demo.from)) / 2);
  });
});

describe("asNow", () => {
  it("sets the time without touching the original", () => {
    const original = ev(T0);
    expect(asNow(original, Date.parse("2026-11-12T00:00:00.000Z")).at).toBe("2026-11-12T00:00:00.000Z");
    expect(original.at).toBe(T0);
  });
});

describe("shifted", () => {
  it("moves nested at, leaves other strings and null alone, does not mutate", () => {
    const state = { lanes: [{ cards: [{ at: T0, title: T0 }] }], checks: { tdd: { at: T0 } }, seal: null, denial: { at: null } };
    const copy = structuredClone(state);
    const out = shifted(state, 1000);
    expect(out.lanes[0].cards[0].at).toBe("2026-11-11T10:00:01.000Z");
    expect(out.checks.tdd.at).toBe("2026-11-11T10:00:01.000Z");
    expect(out.lanes[0].cards[0].title).toBe(T0);
    expect(out.seal).toBeNull();
    expect(out.denial.at).toBeNull();
    expect(state).toEqual(copy);
  });
});
