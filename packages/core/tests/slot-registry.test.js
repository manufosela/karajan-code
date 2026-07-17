// PAR-H (KJC-TSK-0631): stable slots per lane, pure over a JSON file.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireSlot, computePortOffset, releaseSlot } from "../src/slot-registry.js";

const dirs = [];
function registryPath() {
  const dir = mkdtempSync(join(tmpdir(), "kj-slots-"));
  dirs.push(dir);
  return join(dir, "worktree-slots.json");
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("slot-registry (PAR-H)", () => {
  it("assigns the lowest free slot to new ids", async () => {
    const reg = registryPath();
    expect((await acquireSlot({ registryPath: reg, id: "A" })).slot).toBe(0);
    expect((await acquireSlot({ registryPath: reg, id: "B" })).slot).toBe(1);
    expect((await acquireSlot({ registryPath: reg, id: "C" })).slot).toBe(2);
  });

  it("the same id keeps its slot across acquisitions", async () => {
    const reg = registryPath();
    await acquireSlot({ registryPath: reg, id: "A" });
    await acquireSlot({ registryPath: reg, id: "B" });
    const again = await acquireSlot({ registryPath: reg, id: "A" });
    expect(again).toEqual({ slot: 0, reused: true });
  });

  it("released slots are reassigned to the next new id", async () => {
    const reg = registryPath();
    await acquireSlot({ registryPath: reg, id: "A" });
    await acquireSlot({ registryPath: reg, id: "B" });
    expect(await releaseSlot({ registryPath: reg, id: "A" })).toBe(true);
    expect((await acquireSlot({ registryPath: reg, id: "C" })).slot).toBe(0);
  });

  it("releasing an unknown id reports false", async () => {
    const reg = registryPath();
    expect(await releaseSlot({ registryPath: reg, id: "ghost" })).toBe(false);
  });

  it("computePortOffset scales by increment", () => {
    expect(computePortOffset(0)).toBe(0);
    expect(computePortOffset(3)).toBe(300);
    expect(computePortOffset(2, 1000)).toBe(2000);
  });

  it("concurrent acquisitions never hand out duplicate slots", async () => {
    const reg = registryPath();
    const ids = Array.from({ length: 8 }, (_, i) => `lane-${i}`);
    const results = await Promise.all(ids.map((id) => acquireSlot({ registryPath: reg, id })));
    const slots = results.map((r) => r.slot).sort((a, b) => a - b);
    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("a corrupt registry file resets cleanly instead of crashing", async () => {
    const reg = registryPath();
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(reg), { recursive: true });
    writeFileSync(reg, "{not json");
    expect((await acquireSlot({ registryPath: reg, id: "A" })).slot).toBe(0);
  });
});
