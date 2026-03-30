import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/utils/os-detect.js", () => ({
  getInstallCommand: vi.fn().mockReturnValue("curl -fsSL https://example.com/install.sh | sh && rtk init --global"),
  getPlatform: vi.fn().mockReturnValue("linux")
}));

vi.mock("../src/utils/rtk-detect.js", () => ({
  detectRtk: vi.fn()
}));

import { installRtk } from "../src/utils/rtk-install.js";
import { runCommand } from "../src/utils/process.js";
import { getInstallCommand } from "../src/utils/os-detect.js";
import { detectRtk } from "../src/utils/rtk-detect.js";

describe("installRtk", () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  beforeEach(() => {
    vi.resetAllMocks();
    getInstallCommand.mockReturnValue("curl -fsSL https://example.com/install.sh | sh && rtk init --global");
  });

  it("installs RTK and returns ok:true with version on success", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    detectRtk.mockResolvedValue({ available: true, version: "rtk 0.31.0" });

    const result = await installRtk(logger);

    expect(result).toEqual({ ok: true, version: "rtk 0.31.0", error: null });
    expect(runCommand).toHaveBeenCalledWith("sh", ["-c", expect.stringContaining("curl")], { timeout: 120_000 });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Installing RTK"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("installed successfully"));
  });

  it("returns ok:false with error when install command fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "permission denied" });

    const result = await installRtk(logger);

    expect(result).toEqual({ ok: false, version: null, error: "permission denied" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("RTK install failed"));
    // detectRtk should NOT be called when the install command itself fails
    expect(detectRtk).not.toHaveBeenCalled();
  });

  it("returns ok:false when install succeeds but binary not in PATH", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    detectRtk.mockResolvedValue({ available: false, version: null });

    const result = await installRtk(logger);

    expect(result).toEqual({ ok: false, version: null, error: "Binary not found after install" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("not found in PATH"));
  });

  it("returns ok:false without throwing when runCommand throws", async () => {
    runCommand.mockRejectedValue(new Error("ENOENT: sh not found"));

    const result = await installRtk(logger);

    expect(result).toEqual({ ok: false, version: null, error: "ENOENT: sh not found" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("RTK install failed"));
  });

  it("skips install when RTK is already available (integration with init)", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    detectRtk.mockResolvedValue({ available: true, version: "rtk 0.31.0" });

    const result = await installRtk(logger);

    expect(result.ok).toBe(true);
    expect(result.version).toBe("rtk 0.31.0");
  });
});
