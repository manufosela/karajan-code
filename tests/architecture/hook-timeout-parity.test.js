// KJC-TSK-0545 — the lock on a week of file-hopping flakes: the runflow
// family cold-imports the orchestrator graph inside beforeEach, and under
// worker contention that first import blew vitest's DEFAULT 10s hook budget
// while tests enjoyed 120s. An aborted hook leaves mocks half-wired, which
// cascaded into missing events, broken mock objects and even real agent
// spawns. Hooks must share the contention budget the config already grants
// to tests — this test makes the gap structurally impossible to reopen.
import { describe, it, expect } from "vitest";
import config from "../../vitest.config.js";

describe("vitest hook/test timeout parity", () => {
  it("hookTimeout equals testTimeout — hooks pay the same contention tax as tests", () => {
    expect(config.test.hookTimeout).toBe(config.test.testTimeout);
    expect(config.test.hookTimeout).toBeGreaterThanOrEqual(120000);
  });
});
