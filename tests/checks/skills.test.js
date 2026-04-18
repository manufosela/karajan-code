import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn(),
}));

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));

describe("checks/skills", () => {
  let mod, client, proc;

  beforeEach(async () => {
    vi.resetAllMocks();
    mod = await import("../../src/checks/skills.js");
    client = await import("../../src/skills/openskills-client.js");
    proc = await import("../../src/utils/process.js");
  });

  it("passes when openskills CLI is available", async () => {
    client.isOpenSkillsAvailable.mockResolvedValue(true);
    const check = mod.createOpenSkillsCheck();
    const result = await check.detect({});
    expect(result.ok).toBe(true);
  });

  it("warns (not fail) when openskills CLI is missing", async () => {
    client.isOpenSkillsAvailable.mockResolvedValue(false);
    const check = mod.createOpenSkillsCheck();
    const result = await check.detect({});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warn");
    expect(result.fix).toContain("npm install -g openskills");
  });

  it("remediate reports success when npm install exits 0", async () => {
    proc.runCommand.mockResolvedValue({ exitCode: 0, stdout: "added 5 packages", stderr: "" });
    const check = mod.createOpenSkillsCheck();
    const rem = await check.remediate({});
    expect(rem.fixed).toBe(true);
    expect(proc.runCommand).toHaveBeenCalledWith("npm", ["install", "-g", "openskills"], expect.anything());
  });

  it("remediate reports failure when npm install errors", async () => {
    proc.runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "EACCES: permission denied" });
    const check = mod.createOpenSkillsCheck();
    const rem = await check.remediate({});
    expect(rem.fixed).toBe(false);
    expect(rem.detail).toContain("EACCES");
  });

  it("applies only when skills are enabled", () => {
    const check = mod.createOpenSkillsCheck();
    expect(check.applies({})).toBe(true); // default enabled
    expect(check.applies({ skills: { enabled: false } })).toBe(false);
    expect(check.applies({ skills: { enabled: true } })).toBe(true);
  });
});
