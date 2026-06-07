import { describe, it, expect } from "vitest";
import { runCommand } from "../src/process.js";

describe("@karajan/core/process", () => {
  it("captures stdout from a real subprocess", async () => {
    const r = await runCommand("node", ["-e", "process.stdout.write('hi')"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hi");
  });

  it("returns exitCode 1 + spawnError when binary missing (ENOENT)", async () => {
    const r = await runCommand("__definitely_not_a_real_bin__", []);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBeTruthy();
  });

  it("times out and reports timedOut", async () => {
    const r = await runCommand("node", ["-e", "setInterval(() => {}, 1000)"], { timeout: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBe(143);
  });
});
