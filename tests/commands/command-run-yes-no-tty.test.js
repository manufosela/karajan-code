// KJC-BUG-0081 — kj run no debe colgarse en modo --yes sin TTY.
// El bridge de HU Board solo aplica cuando NO hay --yes; con --yes el caller
// pidió explícitamente "no me preguntes nada", así que la sesión debe abortar
// limpio con un mensaje en stderr en vez de quedarse esperando un modal que
// nadie va a ver (CI, scripted runs, kj audit --yes desatendido, etc.).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { createCliAskQuestion } from "../../src/commands/run.js";

describe("createCliAskQuestion — KJC-BUG-0081", () => {
  const origIsTTY = process.stdin.isTTY;
  let stderrWrites;
  let stderrSpy;

  beforeEach(() => {
    stderrWrites = [];
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("returns null without invoking the HU Board bridge when --yes and no TTY", async () => {
    const bridge = await import("../../src/utils/board-prompt-bridge.js");
    const askSpy = vi.spyOn(bridge, "askThroughBoard").mockResolvedValue("should-not-be-called");

    const ask = createCliAskQuestion({ flags: { yes: true } });
    const answer = await ask("¿Confirma la spec?", { detail: { reason: "missing-ac" } });

    expect(answer).toBeNull();
    expect(askSpy).not.toHaveBeenCalled();
    const all = stderrWrites.join("");
    expect(all).toMatch(/non-interactive/);
    expect(all).toMatch(/Stopping the session/);
    expect(all).toMatch(/missing-ac/);
    askSpy.mockRestore();
  });

  it("falls back to the HU Board bridge when no TTY and --yes is not set", async () => {
    const bridge = await import("../../src/utils/board-prompt-bridge.js");
    const askSpy = vi.spyOn(bridge, "askThroughBoard").mockResolvedValue("from-board");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const ask = createCliAskQuestion({ flags: {} });
    const answer = await ask("¿Confirma?", {});

    expect(answer).toBe("from-board");
    expect(askSpy).toHaveBeenCalledOnce();
    askSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
