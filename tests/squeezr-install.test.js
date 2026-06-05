import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/utils/os-detect.js", () => ({
  getInstallCommand: vi.fn().mockReturnValue("npm install -g squeezr-ai"),
  getPlatform: vi.fn().mockReturnValue("linux")
}));

vi.mock("../src/utils/squeezr-detect.js", () => ({
  detectSqueezr: vi.fn()
}));

import { installSqueezr } from "../src/utils/squeezr-install.js";
import { runCommand } from "../src/utils/process.js";
import { getInstallCommand } from "../src/utils/os-detect.js";
import { detectSqueezr } from "../src/utils/squeezr-detect.js";

describe("installSqueezr", () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  beforeEach(() => {
    vi.resetAllMocks();
    getInstallCommand.mockReturnValue("npm install -g squeezr-ai");
  });

  it("installs Squeezr and returns ok:true with version on success", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    detectSqueezr.mockResolvedValue({ available: true, version: "squeezr 1.46.3" });

    const result = await installSqueezr(logger);

    expect(result).toEqual({ ok: true, version: "squeezr 1.46.3", error: null });
    expect(runCommand).toHaveBeenCalledWith("sh", ["-c", "npm install -g squeezr-ai"], { timeout: 120_000 });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Installing Squeezr"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("installed successfully"));
  });

  it("returns ok:false with error when install command fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "permission denied" });

    const result = await installSqueezr(logger);

    expect(result).toEqual({ ok: false, version: null, error: "permission denied" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Squeezr install failed"));
    expect(detectSqueezr).not.toHaveBeenCalled();
  });

  it("returns ok:false when install succeeds but binary not in PATH", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    detectSqueezr.mockResolvedValue({ available: false, version: null });

    const result = await installSqueezr(logger);

    expect(result).toEqual({ ok: false, version: null, error: "Binary not found after install" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("not found in PATH"));
  });

  it("returns ok:false without throwing when runCommand throws", async () => {
    runCommand.mockRejectedValue(new Error("ENOENT: sh not found"));

    const result = await installSqueezr(logger);

    expect(result).toEqual({ ok: false, version: null, error: "ENOENT: sh not found" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Squeezr install failed"));
  });
});
