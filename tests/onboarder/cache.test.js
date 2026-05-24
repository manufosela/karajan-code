// KJC-TSK-0384 PR 3 — readCachedBrief acceptance pins.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCachedBrief } from "../../src/onboarder/cache.js";
import { briefPath } from "../../src/commands/onboard.js";

describe("readCachedBrief — KJC-TSK-0384 PR 3", () => {
  let proj, prevHome, fakeHome;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), "kj-cache-proj-"));
    prevHome = process.env.KARAJAN_HOME;
    fakeHome = mkdtempSync(join(tmpdir(), "kj-cache-home-"));
    process.env.KARAJAN_HOME = fakeHome;
  });
  afterEach(() => {
    rmSync(proj, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.KARAJAN_HOME;
    else process.env.KARAJAN_HOME = prevHome;
  });

  it("returns { found: false, path } when no brief exists", async () => {
    const result = await readCachedBrief(proj);
    expect(result.found).toBe(false);
    expect(result.path).toBe(briefPath(proj));
  });

  it("returns { found: true, content } when the brief exists", async () => {
    const target = briefPath(proj);
    mkdirSync(join(fakeHome, "onboarding"), { recursive: true });
    writeFileSync(target, "# Architecture Brief\n\nbody\n", "utf8");
    const result = await readCachedBrief(proj);
    expect(result.found).toBe(true);
    expect(result.path).toBe(target);
    expect(result.content).toContain("Architecture Brief");
  });
});
