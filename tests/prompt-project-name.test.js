import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable, Writable } from "node:stream";

afterEach(() => { vi.restoreAllMocks(); });

async function runWithStubbedStdio(input, defaultName) {
  const stdinReplacement = Readable.from([input]);
  const stdoutReplacement = new Writable({ write(_, __, cb) { cb(); } });
  const realIn = process.stdin;
  const realOut = process.stdout;
  Object.defineProperty(process, "stdin", { value: stdinReplacement, configurable: true });
  Object.defineProperty(process, "stdout", { value: stdoutReplacement, configurable: true });
  try {
    const { promptProjectName } = await import("../src/utils/prompt-project-name.js");
    return await promptProjectName(defaultName);
  } finally {
    Object.defineProperty(process, "stdin", { value: realIn, configurable: true });
    Object.defineProperty(process, "stdout", { value: realOut, configurable: true });
  }
}

describe("promptProjectName", () => {
  it("returns the default when the user just hits ENTER", async () => {
    expect(await runWithStubbedStdio("\n", "Linux Assistant")).toBe("Linux Assistant");
  });

  it("returns the user's typed answer when non-empty", async () => {
    expect(await runWithStubbedStdio("Mi Proyecto Mejor\n", "default")).toBe("Mi Proyecto Mejor");
  });

  it("trims surrounding whitespace from the user's answer", async () => {
    expect(await runWithStubbedStdio("   spaced   \n", "default")).toBe("spaced");
  });

  it("uses an empty fallback when the default is empty/null", async () => {
    expect(await runWithStubbedStdio("\n", null)).toBe("");
    expect(await runWithStubbedStdio("\n", "")).toBe("");
    expect(await runWithStubbedStdio("\n", undefined)).toBe("");
  });

  it("trims the default before using it", async () => {
    expect(await runWithStubbedStdio("\n", "  Padded  ")).toBe("Padded");
  });
});
