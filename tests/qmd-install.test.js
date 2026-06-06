import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/utils/os-detect.js", () => ({
  getInstallCommand: vi.fn().mockReturnValue("npm install -g @tobilu/qmd"),
  getPlatform: vi.fn().mockReturnValue("linux")
}));

vi.mock("../src/utils/qmd-detect.js", () => ({
  detectQmd: vi.fn()
}));

import { installQmd } from "../src/utils/qmd-install.js";
import { runCommand } from "../src/utils/process.js";
import { getInstallCommand } from "../src/utils/os-detect.js";
import { detectQmd } from "../src/utils/qmd-detect.js";

describe("installQmd", () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  beforeEach(() => {
    vi.resetAllMocks();
    getInstallCommand.mockReturnValue("npm install -g @tobilu/qmd");
  });

  it("installs QMD and returns ok:true with version on success", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    detectQmd.mockResolvedValue({ available: true, version: "qmd 2.5.3" });

    const result = await installQmd(logger);

    expect(result).toEqual({ ok: true, version: "qmd 2.5.3", error: null });
    expect(runCommand).toHaveBeenCalledWith("sh", ["-c", "npm install -g @tobilu/qmd"], { timeout: 120_000 });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Installing QMD"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("installed successfully"));
  });

  it("returns ok:false with error when install command fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "permission denied" });

    const result = await installQmd(logger);

    expect(result).toEqual({ ok: false, version: null, error: "permission denied" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("QMD install failed"));
    expect(detectQmd).not.toHaveBeenCalled();
  });

  it("returns ok:false when install succeeds but binary not in PATH", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    detectQmd.mockResolvedValue({ available: false, version: null });

    const result = await installQmd(logger);

    expect(result).toEqual({ ok: false, version: null, error: "Binary not found after install" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("not found in PATH"));
  });

  it("returns ok:false without throwing when runCommand throws", async () => {
    runCommand.mockRejectedValue(new Error("ENOENT: sh not found"));

    const result = await installQmd(logger);

    expect(result).toEqual({ ok: false, version: null, error: "ENOENT: sh not found" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("QMD install failed"));
  });
});
