import { describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

import { detectSqueezr } from "../src/utils/squeezr-detect.js";
import { runCommand } from "../src/utils/process.js";

describe("detectSqueezr", () => {
  it("extracts the bare semver when squeezr --version succeeds", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "squeezr 1.46.3" });

    const result = await detectSqueezr();

    expect(result).toEqual({ available: true, version: "1.46.3" });
    expect(runCommand).toHaveBeenCalledWith("squeezr", ["--version"]);
  });

  it("strips the update-available banner, keeping only the version (KJC-BUG-0088)", async () => {
    const stdout = "1.24.0\n  ╭─────────╮\n  │ Update available: v1.24.0 → v1.81.1 │\n  ╰─────────╯";
    runCommand.mockResolvedValue({ exitCode: 0, stdout });

    expect(await detectSqueezr()).toEqual({ available: true, version: "1.24.0" });
  });

  it("returns available:false when squeezr --version fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "" });

    const result = await detectSqueezr();

    expect(result).toEqual({ available: false, version: null });
  });

  it("returns available:false when runCommand throws", async () => {
    runCommand.mockRejectedValue(new Error("ENOENT"));

    const result = await detectSqueezr();

    expect(result).toEqual({ available: false, version: null });
  });

  it("handles empty stdout gracefully", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "" });

    const result = await detectSqueezr();

    expect(result).toEqual({ available: true, version: null });
  });
});
