import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// KJL-TSK-0162 (ADR 0052): the factory page replays HU-3870 as record-factory-demo.mjs
// recorded it, in the lanes main and kj-stage, with nothing personal in it.
const FILE = join(import.meta.dirname, "../../apps/landing/public/factory/demo-hu-3870.json");
const text = readFileSync(FILE, "utf8");
const demo = JSON.parse(text);
const TYPES = new Set(["card", "agent-activity", "sentinel-deny", "review-verdict", "method-check", "ledger-seal", "commit-gate"]);

describe("the factory demo", () => {
  it("is HU-3870 from its start to done, in main and kj-stage", () => {
    expect(demo).toMatchObject({ task: "HU-3870", lanes: ["main", "kj-stage"] });
    expect(Date.parse(demo.from)).toBeLessThan(Date.parse(demo.to));
    expect(demo.state.lanes.map((l) => l.lane)).toEqual(demo.lanes);
  });

  it("holds stage events of its lanes, in order and inside the window", () => {
    const times = demo.events.map((e) => Date.parse(e.at));
    expect(times).toEqual(times.toSorted((a, b) => a - b));
    expect(times[0]).toBeGreaterThanOrEqual(Date.parse(demo.from));
    expect(times.at(-1)).toBeLessThanOrEqual(Date.parse(demo.to));
    for (const e of demo.events) {
      expect(TYPES.has(e.type), e.type).toBe(true);
      expect(demo.lanes).toContain(e.lane);
    }
  });

  it("carries no user path, email, session id, session name or command", () => {
    expect(text).not.toMatch(/\/home\/|\/tmp\/|\/Users\/|[A-Z]:\\\\Users/);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(text).not.toMatch(/"command"|"name"/);
    const ids = demo.events.filter((e) => e.type === "agent-activity" && e.id !== null).map((e) => e.id);
    expect(ids.every((id) => /^session-\d+$/.test(id))).toBe(true);
  });
});
