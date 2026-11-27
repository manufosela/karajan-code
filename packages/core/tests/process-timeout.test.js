import { describe, it, expect, vi } from "vitest";
import { execa } from "execa";
import { runCommand } from "../src/process.js";

vi.mock("execa", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execa: vi.fn(actual.execa) };
});

const PRINT_PID = "process.stdout.write(String(process.pid));";
const SILENT_CHILD = `${PRINT_PID}setTimeout(()=>{},30000)`;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

/** Runs a child that stays silent after printing its pid; checks it is really gone. */
async function expectChildKilled(options) {
  const startedAt = Date.now();
  const result = await runCommand(process.execPath, ["-e", SILENT_CHILD], options);
  const elapsed = Date.now() - startedAt;
  const pid = Number(result.stdout);
  expect(pid).toBeGreaterThan(0);
  try {
    expect(result).toMatchObject({ exitCode: 143, timedOut: true });
    expect(elapsed).toBeLessThan(2000);
    await expect.poll(() => isAlive(pid), { timeout: 1000 }).toBe(false);
  } finally {
    if (isAlive(pid)) process.kill(pid, "SIGKILL");
  }
}

/** A child that never ends and whose kill() throws. */
function unkillableChild() {
  const child = new Promise(() => {});
  child.kill = () => {
    throw new Error("EPERM: not allowed");
  };
  return child;
}

describe("karajan-core/process timeouts kill the child", () => {
  it("kills the child when the timeout expires", async () => {
    await expectChildKilled({ timeout: 300 });
  });

  it("kills the child that goes silent after printing once", async () => {
    await expectChildKilled({ silenceTimeoutMs: 300 });
  });

  it.each([
    [{ timeout: 20 }, "Command timed out after 20ms"],
    [{ silenceTimeoutMs: 20 }, "Command killed after 20ms without output"],
    [{ silenceTimeoutMs: 20, timeout: 60000 }, "Command killed after 20ms without output"],
  ])("reports a kill() failure in stderr (%o)", async (options, message) => {
    execa.mockImplementationOnce(unkillableChild);
    const result = await runCommand("whatever", [], options);
    expect(result).toMatchObject({ exitCode: 143, timedOut: true });
    expect(result.stderr).toBe(`${message}; kill failed: EPERM: not allowed`);
  });
});
