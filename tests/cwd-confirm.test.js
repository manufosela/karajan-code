import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable, Writable } from "node:stream";

// PR-F: confirmCwd() asks the user "Run on $(pwd)?" before launching
// kj run from a terminal. Tests stub stdin/stdout via piped streams
// so we can drive the prompt deterministically without a TTY.

afterEach(() => { vi.restoreAllMocks(); });

async function runWithStubbedStdio(input) {
  // Replace process.stdin / stdout temporarily; readline reads from
  // the streams we hand it via process.stdin / process.stdout, so
  // monkey-patching for the duration of one call is enough.
  const stdinReplacement = Readable.from([input]);
  const stdoutReplacement = new Writable({ write(_, __, cb) { cb(); } });
  const realIn = process.stdin;
  const realOut = process.stdout;
  Object.defineProperty(process, "stdin", { value: stdinReplacement, configurable: true });
  Object.defineProperty(process, "stdout", { value: stdoutReplacement, configurable: true });
  try {
    const { confirmCwd } = await import("../src/utils/cwd-confirm.js");
    return await confirmCwd("/home/user/project");
  } finally {
    Object.defineProperty(process, "stdin", { value: realIn, configurable: true });
    Object.defineProperty(process, "stdout", { value: realOut, configurable: true });
  }
}

describe("confirmCwd", () => {
  it("returns true on empty input (ENTER = default Yes)", async () => {
    expect(await runWithStubbedStdio("\n")).toBe(true);
  });

  it("returns true on 'y' / 'yes' / 's' / 'sí'", async () => {
    expect(await runWithStubbedStdio("y\n")).toBe(true);
    expect(await runWithStubbedStdio("yes\n")).toBe(true);
    expect(await runWithStubbedStdio("s\n")).toBe(true);
    expect(await runWithStubbedStdio("sí\n")).toBe(true);
  });

  it("returns false on 'n' / 'no'", async () => {
    expect(await runWithStubbedStdio("n\n")).toBe(false);
    expect(await runWithStubbedStdio("no\n")).toBe(false);
  });

  it("returns false on any other answer (defensive — abort if unsure)", async () => {
    expect(await runWithStubbedStdio("maybe\n")).toBe(false);
    expect(await runWithStubbedStdio("xyz\n")).toBe(false);
  });

  it("trims whitespace and lowercases the answer", async () => {
    expect(await runWithStubbedStdio("  Y  \n")).toBe(true);
    expect(await runWithStubbedStdio("  N  \n")).toBe(false);
  });
});
