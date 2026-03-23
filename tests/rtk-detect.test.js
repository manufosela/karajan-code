import { describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

import { detectRtk } from "../src/utils/rtk-detect.js";
import { runCommand } from "../src/utils/process.js";

describe("detectRtk", () => {
  it("returns available:true when rtk --version succeeds", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "rtk 0.5.2" });

    const result = await detectRtk();

    expect(result).toEqual({ available: true, version: "rtk 0.5.2" });
    expect(runCommand).toHaveBeenCalledWith("rtk", ["--version"]);
  });

  it("returns available:false when rtk --version fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "" });

    const result = await detectRtk();

    expect(result).toEqual({ available: false, version: null });
  });

  it("returns available:false when runCommand throws", async () => {
    runCommand.mockRejectedValue(new Error("ENOENT"));

    const result = await detectRtk();

    expect(result).toEqual({ available: false, version: null });
  });

  it("handles empty stdout gracefully", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "" });

    const result = await detectRtk();

    expect(result).toEqual({ available: true, version: null });
  });
});
