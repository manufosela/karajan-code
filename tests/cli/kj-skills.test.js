import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

const { runCommand } = await import("../src/utils/process.js");
const {
  isOpenSkillsAvailable,
  installSkill,
  removeSkill,
  listSkills,
  readSkill
} = await import("../src/skills/openskills-client.js");

describe("openskills-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isOpenSkillsAvailable", () => {
    it("returns true when npx openskills --version succeeds", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "1.0.0", stderr: "" });
      const result = await isOpenSkillsAvailable();
      expect(result).toBe(true);
      expect(runCommand).toHaveBeenCalledWith("npx", ["openskills", "--version"], expect.objectContaining({ timeout: 15_000 }));
    });

    it("returns false when npx openskills --version fails", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "not found" });
      const result = await isOpenSkillsAvailable();
      expect(result).toBe(false);
    });

    it("returns false when runCommand throws", async () => {
      runCommand.mockRejectedValue(new Error("ENOENT"));
      const result = await isOpenSkillsAvailable();
      expect(result).toBe(false);
    });
  });

  describe("installSkill", () => {
    it("returns success with skill name on successful install", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: 'installed skill "react-patterns"',
        stderr: ""
      });

      const result = await installSkill("react-patterns", { projectDir: "/tmp/proj" });
      expect(result).toEqual({ ok: true, name: "react-patterns" });
      expect(runCommand).toHaveBeenCalledWith(
        "npx",
        ["openskills", "install", "react-patterns"],
        expect.objectContaining({ cwd: "/tmp/proj" })
      );
    });

    it("passes --global flag when global is true", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "installed my-skill", stderr: "" });

      await installSkill("my-skill", { global: true });
      expect(runCommand).toHaveBeenCalledWith(
        "npx",
        ["openskills", "install", "my-skill", "--global"],
        expect.any(Object)
      );
    });

    it("returns error when source is missing", async () => {
      const result = await installSkill(null);
      expect(result).toEqual({ ok: false, error: "source is required for install" });
      expect(runCommand).not.toHaveBeenCalled();
    });

    it("returns error when install command fails", async () => {
      runCommand.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "skill not found in marketplace"
      });

      const result = await installSkill("nonexistent-skill");
      expect(result).toEqual({ ok: false, error: "skill not found in marketplace" });
    });
  });

  describe("removeSkill", () => {
    it("returns success on removal", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "removed", stderr: "" });

      const result = await removeSkill("old-skill", { projectDir: "/tmp/proj" });
      expect(result).toEqual({ ok: true });
      expect(runCommand).toHaveBeenCalledWith(
        "npx",
        ["openskills", "remove", "old-skill"],
        expect.objectContaining({ cwd: "/tmp/proj" })
      );
    });

    it("returns error when name is missing", async () => {
      const result = await removeSkill(null);
      expect(result).toEqual({ ok: false, error: "name is required for remove" });
      expect(runCommand).not.toHaveBeenCalled();
    });

    it("returns error when remove fails", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "skill not installed" });
      const result = await removeSkill("missing-skill");
      expect(result).toEqual({ ok: false, error: "skill not installed" });
    });
  });

  describe("listSkills", () => {
    it("returns parsed JSON skill list", async () => {
      const skills = [
        { name: "react-patterns", source: "marketplace", scope: "project" },
        { name: "node-security", source: "github:user/repo", scope: "global" }
      ];
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(skills),
        stderr: ""
      });

      const result = await listSkills({ projectDir: "/tmp/proj" });
      expect(result).toEqual({ ok: true, skills });
    });

    it("falls back to text parsing when --json fails", async () => {
      // First call (--json) fails
      runCommand.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "unknown flag" });
      // Second call (text) succeeds
      runCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: "react-patterns\nnode-security\n",
        stderr: ""
      });

      const result = await listSkills();
      expect(result).toEqual({
        ok: true,
        skills: [{ name: "react-patterns" }, { name: "node-security" }]
      });
    });

    it("returns error when both list attempts fail", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "openskills not found" });

      const result = await listSkills();
      expect(result).toEqual({ ok: false, error: "openskills not found" });
    });
  });

  describe("readSkill", () => {
    it("returns skill content", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "# React Patterns\nUse hooks for state management...",
        stderr: ""
      });

      const result = await readSkill("react-patterns", { projectDir: "/tmp/proj" });
      expect(result).toEqual({
        ok: true,
        content: "# React Patterns\nUse hooks for state management..."
      });
    });

    it("returns error when name is missing", async () => {
      const result = await readSkill(null);
      expect(result).toEqual({ ok: false, error: "name is required for read" });
      expect(runCommand).not.toHaveBeenCalled();
    });

    it("returns error when read fails", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "skill not found" });
      const result = await readSkill("nonexistent");
      expect(result).toEqual({ ok: false, error: "skill not found" });
    });
  });
});

const { handleToolCall } = await import("../src/mcp/server-handlers.js");

describe("kj_skills handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when action is missing", async () => {
    const result = await handleToolCall("kj_skills", {}, null, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("action");
  });

  it("returns error when source is missing for install", async () => {
    // isOpenSkillsAvailable check runs first — make it succeed
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "1.0.0", stderr: "" });
    const result = await handleToolCall("kj_skills", { action: "install" }, null, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("source");
  });

  it("returns error when openskills is unavailable for install", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "not found" });
    const result = await handleToolCall("kj_skills", { action: "install", source: "my-skill" }, null, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("OpenSkills CLI is not available");
  });

  it("returns error when name is missing for remove", async () => {
    const result = await handleToolCall("kj_skills", { action: "remove" }, null, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("name");
  });

  it("returns error for unknown action", async () => {
    const result = await handleToolCall("kj_skills", { action: "unknown" }, null, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown skills action");
  });
});
