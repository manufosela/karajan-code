import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, writeJsonAtomicSync } from "../../src/utils/atomic-write.js";

// Resilience audit, Phase 2: state writes must be crash-safe. A plain
// writeFile truncates the live file first; a kill mid-write loses it.
// write-temp + rename means a reader sees the old file or the complete
// new one — never a half-written one — and no .tmp is left on success.

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-atomic-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const tmpLeftovers = () => readdirSync(dir).filter((f) => f.endsWith(".tmp"));

describe("writeJsonAtomicSync", () => {
  it("writes valid JSON and leaves no .tmp behind", () => {
    const target = join(dir, "state.json");
    writeJsonAtomicSync(target, { a: 1, b: "x" });
    expect(JSON.parse(readFileSync(target, "utf-8"))).toEqual({ a: 1, b: "x" });
    expect(tmpLeftovers()).toEqual([]);
  });

  it("replaces an existing file's content completely", () => {
    const target = join(dir, "state.json");
    writeFileSync(target, JSON.stringify({ old: true, extra: "gone" }));
    writeJsonAtomicSync(target, { new: true });
    expect(JSON.parse(readFileSync(target, "utf-8"))).toEqual({ new: true });
  });
});

describe("writeJsonAtomic (async)", () => {
  it("writes valid JSON and leaves no .tmp behind", async () => {
    const target = join(dir, "state.json");
    await writeJsonAtomic(target, { nested: { x: [1, 2] } });
    expect(JSON.parse(readFileSync(target, "utf-8"))).toEqual({ nested: { x: [1, 2] } });
    expect(tmpLeftovers()).toEqual([]);
  });

  it("concurrent writers do not collide on the temp file", async () => {
    const target = join(dir, "state.json");
    await Promise.all([
      writeJsonAtomic(target, { writer: 1 }),
      writeJsonAtomic(target, { writer: 2 }),
    ]);
    // One of the two writers wins; the file is always valid JSON.
    expect([1, 2]).toContain(JSON.parse(readFileSync(target, "utf-8")).writer);
    expect(tmpLeftovers()).toEqual([]);
  });
});
