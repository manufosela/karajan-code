import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/utils/process.js";

describe("runCommand onOutput streaming", () => {
  it("calls onOutput for each line of stdout", async () => {
    const lines = [];
    const onOutput = ({ stream, line }) => lines.push({ stream, line });

    const result = await runCommand("echo", ["-e", "line1\nline2\nline3"], { onOutput });

    expect(result.exitCode).toBe(0);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const stdoutLines = lines.filter((l) => l.stream === "stdout");
    expect(stdoutLines.length).toBeGreaterThanOrEqual(1);
    expect(stdoutLines.some((l) => l.line.includes("line1"))).toBe(true);
  });

  it("calls onOutput for stderr", async () => {
    const lines = [];
    const onOutput = ({ stream, line }) => lines.push({ stream, line });

    const result = await runCommand("bash", ["-c", "echo err_msg >&2"], { onOutput });

    const stderrLines = lines.filter((l) => l.stream === "stderr");
    expect(stderrLines.some((l) => l.line.includes("err_msg"))).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("works without onOutput (backward compatible)", async () => {
    const result = await runCommand("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("still returns full stdout even with onOutput", async () => {
    const lines = [];
    const result = await runCommand("echo", ["full_output"], {
      onOutput: ({ stream, line }) => lines.push({ stream, line })
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("full_output");
  });

  it("filters out empty lines from onOutput", async () => {
    const lines = [];
    const result = await runCommand("echo", ["-e", "a\n\nb"], {
      onOutput: ({ stream, line }) => lines.push({ stream, line })
    });

    expect(result.exitCode).toBe(0);
    const stdoutLines = lines.filter((l) => l.stream === "stdout");
    for (const l of stdoutLines) {
      expect(l.line).not.toBe("");
    }
  });
});
