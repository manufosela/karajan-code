import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readPlanCached } from "../../packages/hu-board/src/routes/api.js";

// KJC-TSK-0539 — the plan scans must not re-parse unchanged files on
// every request. readPlanCached serves the parsed object while the
// file mtime is stable and re-reads transparently after a write.

describe("hu-board readPlanCached", () => {
  let tmpDir;
  let planPath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-plan-cache-"));
    planPath = path.join(tmpDir, "plan-x.json");
    await fs.writeFile(planPath, JSON.stringify({ planId: "x", version: 2, name: "one" }));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the same parsed object (cache hit) while mtime is unchanged", async () => {
    const first = await readPlanCached(planPath);
    const second = await readPlanCached(planPath);
    expect(first.name).toBe("one");
    expect(second).toBe(first);
  });

  it("re-reads when the file changes (mtime invalidation)", async () => {
    const first = await readPlanCached(planPath);
    expect(first.name).toBe("one");
    // Force a different mtime even on coarse-grained filesystems.
    await fs.writeFile(planPath, JSON.stringify({ planId: "x", version: 2, name: "two" }));
    const future = new Date(Date.now() + 5000);
    await fs.utimes(planPath, future, future);

    const second = await readPlanCached(planPath);
    expect(second.name).toBe("two");
    expect(second).not.toBe(first);
  });

  it("propagates stat errors for missing files (no silent fallback)", async () => {
    await expect(readPlanCached(path.join(tmpDir, "nope.json"))).rejects.toThrow();
  });
});
