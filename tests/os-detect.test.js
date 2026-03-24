import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";

vi.mock("node:os", () => ({
  default: { platform: vi.fn() },
  platform: vi.fn()
}));

describe("os-detect", () => {
  let getPlatform, getInstallCommand;

  beforeEach(async () => {
    vi.resetModules();
    os.platform.mockReturnValue("linux");
    ({ getPlatform, getInstallCommand } = await import("../src/utils/os-detect.js"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getPlatform", () => {
    it("returns 'macos' on darwin", async () => {
      vi.resetModules();
      os.platform.mockReturnValue("darwin");
      ({ getPlatform } = await import("../src/utils/os-detect.js"));
      expect(getPlatform()).toBe("macos");
    });

    it("returns 'linux' on linux", async () => {
      vi.resetModules();
      os.platform.mockReturnValue("linux");
      ({ getPlatform } = await import("../src/utils/os-detect.js"));
      expect(getPlatform()).toBe("linux");
    });

    it("returns 'linux' on unknown platforms", async () => {
      vi.resetModules();
      os.platform.mockReturnValue("freebsd");
      ({ getPlatform } = await import("../src/utils/os-detect.js"));
      expect(getPlatform()).toBe("linux");
    });
  });

  describe("getInstallCommand", () => {
    it("returns correct rtk command for linux", async () => {
      vi.resetModules();
      os.platform.mockReturnValue("linux");
      ({ getInstallCommand } = await import("../src/utils/os-detect.js"));
      const cmd = getInstallCommand("rtk");
      expect(cmd).toContain("curl -fsSL");
      expect(cmd).not.toContain("brew");
    });

    it("returns correct rtk command for macOS", async () => {
      vi.resetModules();
      os.platform.mockReturnValue("darwin");
      ({ getInstallCommand } = await import("../src/utils/os-detect.js"));
      const cmd = getInstallCommand("rtk");
      expect(cmd).toContain("brew install rtk");
    });

    it("returns correct claude command", () => {
      const cmd = getInstallCommand("claude");
      expect(cmd).toBe("npm install -g @anthropic-ai/claude-code");
    });

    it("returns correct codex command", () => {
      const cmd = getInstallCommand("codex");
      expect(cmd).toBe("npm install -g @openai/codex");
    });

    it("returns correct gemini command", () => {
      const cmd = getInstallCommand("gemini");
      expect(cmd).toBe("npm install -g @google/gemini-cli");
    });

    it("returns correct aider command for linux", async () => {
      vi.resetModules();
      os.platform.mockReturnValue("linux");
      ({ getInstallCommand } = await import("../src/utils/os-detect.js"));
      const cmd = getInstallCommand("aider");
      expect(cmd).toContain("pip3");
    });

    it("returns correct aider command for macOS", async () => {
      vi.resetModules();
      os.platform.mockReturnValue("darwin");
      ({ getInstallCommand } = await import("../src/utils/os-detect.js"));
      const cmd = getInstallCommand("aider");
      expect(cmd).toBe("pipx install aider-chat");
    });

    it("returns correct opencode command", () => {
      const cmd = getInstallCommand("opencode");
      expect(cmd).toContain("opencode.ai/install");
    });

    it("returns correct docker command for linux", async () => {
      vi.resetModules();
      os.platform.mockReturnValue("linux");
      ({ getInstallCommand } = await import("../src/utils/os-detect.js"));
      const cmd = getInstallCommand("docker");
      expect(cmd).toContain("apt");
    });

    it("returns correct docker command for macOS", async () => {
      vi.resetModules();
      os.platform.mockReturnValue("darwin");
      ({ getInstallCommand } = await import("../src/utils/os-detect.js"));
      const cmd = getInstallCommand("docker");
      expect(cmd).toContain("brew install --cask docker");
    });

    it("returns fallback for unknown tool", () => {
      const cmd = getInstallCommand("unknown-tool");
      expect(cmd).toBe("Install unknown-tool manually");
    });
  });
});
