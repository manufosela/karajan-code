import { describe, it, expect } from "vitest";
import { runCommand } from "../src/utils/process.js";

// Resilience audit, Phase 2: execa with reject:false resolves (not
// throws) on a spawn failure. ENOENT used to come back with exitCode
// undefined and an empty stderr, so a missing agent CLI failed with
// no message at all. runCommand must always surface the cause.

describe("runCommand — spawn failure (ENOENT)", () => {
  it("surfaces a non-empty error and a real exit code when the binary is missing", async () => {
    const res = await runCommand("kj-nonexistent-binary-xyz-123", ["--version"]);
    expect(res.exitCode).toBe(1);
    expect(typeof res.stderr).toBe("string");
    expect(res.stderr.length).toBeGreaterThan(0);
    expect(res.spawnError).toBe("ENOENT");
  });

  it("a binary that exists still reports its own exit code (no false ENOENT)", async () => {
    const res = await runCommand("node", ["-e", "process.exit(3)"]);
    expect(res.exitCode).toBe(3);
    expect(res.spawnError).toBeUndefined();
  });
});
