import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));

describe("utils/port-occupant", () => {
  let getPortOccupant, runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ getPortOccupant } = await import("../../src/utils/port-occupant.js"));
    ({ runCommand } = await import("../../src/utils/process.js"));
  });

  it("parses lsof -Fpcn output into pid + command", async () => {
    if (process.platform === "win32") return; // skip on Windows
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "p12345\ncnode\nn*:4000",
      stderr: "",
    });
    const occ = await getPortOccupant(4000);
    expect(occ).not.toBeNull();
    expect(occ.pid).toBe(12345);
    expect(occ.command).toBe("node");
    expect(occ.port).toBe(4000);
  });

  it("returns null when lsof and ss both produce no output", async () => {
    if (process.platform === "win32") return;
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    const occ = await getPortOccupant(4000);
    expect(occ).toBeNull();
  });

  it("falls back to ss parsing when lsof returns nothing", async () => {
    if (process.platform === "win32") return;
    runCommand.mockImplementation((cmd) => {
      if (cmd === "lsof") return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      return Promise.resolve({
        exitCode: 0,
        stdout: 'LISTEN 0 511 0.0.0.0:4000 0.0.0.0:* users:(("node",pid=54321,fd=20))',
        stderr: "",
      });
    });
    const occ = await getPortOccupant(4000);
    expect(occ).not.toBeNull();
    expect(occ.pid).toBe(54321);
    expect(occ.command).toBe("node");
  });

  it("never throws on unexpected errors (best-effort)", async () => {
    if (process.platform === "win32") return;
    runCommand.mockRejectedValue(new Error("boom"));
    const occ = await getPortOccupant(4000);
    expect(occ).toBeNull();
  });
});
