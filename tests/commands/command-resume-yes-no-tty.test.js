// KJC-BUG-0081 round 2 — `kj resume <id> --yes` también debe abortar
// sin TTY en lugar de colgarse en el bridge del HU Board.
//
// Round 1 (PR #995) arregló `src/commands/run.js` pero olvidó la copia
// duplicada de `createCliAskQuestion` en `src/commands/resume.js`, así
// que `kj resume <sid> --yes` desde un Cron / CI seguía colgándose en
// el primer `elicitInput`. Round 2 extrae el helper a
// `src/utils/cli-ask-question.js` y este test confirma que la nueva
// importación de resume.js propaga `flags` correctamente.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Importamos el helper compartido — resume.js no exporta nada al respecto
// (lo usa internamente) y el contrato canónico vive en utils/.
import { createCliAskQuestion } from "../../src/utils/cli-ask-question.js";

describe("resume.js askQuestion contract — KJC-BUG-0081 round 2", () => {
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

    const ask = createCliAskQuestion({ sessionId: "sess_abc", flags: { yes: true } });
    const answer = await ask("¿Reanudar?", { detail: { reason: "checkpoint" } });

    expect(answer).toBeNull();
    expect(askSpy).not.toHaveBeenCalled();
    const all = stderrWrites.join("");
    expect(all).toMatch(/non-interactive/);
    expect(all).toMatch(/checkpoint/);
    askSpy.mockRestore();
  });

  it("falls back to the HU Board bridge when no TTY and --yes is not set", async () => {
    const bridge = await import("../../src/utils/board-prompt-bridge.js");
    const askSpy = vi.spyOn(bridge, "askThroughBoard").mockResolvedValue("from-board");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const ask = createCliAskQuestion({ sessionId: "sess_abc", flags: {} });
    const answer = await ask("¿Reanudar?", {});

    expect(answer).toBe("from-board");
    expect(askSpy).toHaveBeenCalledOnce();
    expect(askSpy.mock.calls[0][0]).toMatchObject({ sessionId: "sess_abc" });
    askSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
