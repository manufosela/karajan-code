import { describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

import { detectSqueezr } from "../src/utils/squeezr-detect.js";
import { runCommand } from "../src/utils/process.js";

describe("detectSqueezr", () => {
  it("returns available:true when squeezr --version succeeds", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "squeezr 1.46.3" });

    const result = await detectSqueezr();

    expect(result).toEqual({ available: true, version: "squeezr 1.46.3" });
    expect(runCommand).toHaveBeenCalledWith("squeezr", ["--version"]);
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
