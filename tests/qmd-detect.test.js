import { describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

import { detectQmd } from "../src/utils/qmd-detect.js";
import { runCommand } from "../src/utils/process.js";

describe("detectQmd", () => {
  it("returns available:true when qmd --version succeeds", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "qmd 2.5.3" });

    const result = await detectQmd();

    expect(result).toEqual({ available: true, version: "qmd 2.5.3" });
    expect(runCommand).toHaveBeenCalledWith("qmd", ["--version"]);
  });

  it("returns available:false when qmd --version fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "" });

    const result = await detectQmd();

    expect(result).toEqual({ available: false, version: null });
  });

  it("returns available:false when runCommand throws", async () => {
    runCommand.mockRejectedValue(new Error("ENOENT"));

    const result = await detectQmd();

    expect(result).toEqual({ available: false, version: null });
  });

  it("handles empty stdout gracefully", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "" });

    const result = await detectQmd();

    expect(result).toEqual({ available: true, version: null });
  });
});
