import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askThroughBoard, _getPromptsDirForTests } from "../src/utils/board-prompt-bridge.js";

let tmp;
let savedHome;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kj-prompt-bridge-"));
  savedHome = process.env.KJ_HOME;
  process.env.KJ_HOME = tmp;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = savedHome;
  rmSync(tmp, { recursive: true, force: true });
});

describe("askThroughBoard", () => {
  it("writes a prompt JSON, waits, and resolves with the answer when an answer file appears", async () => {
    const promptsDir = _getPromptsDirForTests();
    expect(promptsDir).toContain(tmp);

    // Race: kick off the bridge, then write the answer file 50ms later.
    const future = askThroughBoard({
      sessionId: "sess-1", question: "Pick A or B", context: { iteration: 3 }, timeoutMs: 5000,
    });

    setTimeout(() => {
      const files = readdirSync(promptsDir).filter((f) => !f.endsWith(".answer.json"));
      const promptFile = files[0];
      const promptId = promptFile.replace(/\.json$/, "");
      writeFileSync(
        join(promptsDir, `${promptId}.answer.json`),
        JSON.stringify({ answer: "A", answeredAt: new Date().toISOString() }),
        "utf-8"
      );
    }, 80);

    const result = await future;
    expect(result).toBe("A");
    // Both files cleaned up.
    const remaining = readdirSync(promptsDir);
    expect(remaining).toEqual([]);
  });

  it("returns null when the user answers 'stop' (case-insensitive, trimmed)", async () => {
    const promptsDir = _getPromptsDirForTests();
    const future = askThroughBoard({ sessionId: "s", question: "?", timeoutMs: 5000 });
    setTimeout(() => {
      const promptFile = readdirSync(promptsDir).find((f) => !f.endsWith(".answer.json"));
      const id = promptFile.replace(/\.json$/, "");
      writeFileSync(join(promptsDir, `${id}.answer.json`), JSON.stringify({ answer: "  STOP  " }));
    }, 50);
    const result = await future;
    expect(result).toBeNull();
  });

  it("times out cleanly if no answer arrives, leaving no prompt file behind", async () => {
    const promptsDir = _getPromptsDirForTests();
    await expect(
      askThroughBoard({ sessionId: "s", question: "?", timeoutMs: 200 })
    ).rejects.toThrow(/timed out/);
    // Best-effort cleanup means the prompt file is gone after timeout.
    expect(readdirSync(promptsDir)).toEqual([]);
  });

  it("aborts when the AbortSignal fires", async () => {
    const ctrl = new AbortController();
    const promptsDir = _getPromptsDirForTests();
    const future = askThroughBoard({ sessionId: "s", question: "?", timeoutMs: 5000, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 100);
    await expect(future).rejects.toThrow(/aborted/);
    expect(readdirSync(promptsDir)).toEqual([]);
  });

  it("publishes a JSON file with sessionId / question / context / createdAt", async () => {
    const promptsDir = _getPromptsDirForTests();
    let snapshot = null;
    const future = askThroughBoard({
      sessionId: "abc", question: "Why?", context: { extra: 1 }, timeoutMs: 5000,
    });
    setTimeout(() => {
      const promptFile = readdirSync(promptsDir).find((f) => !f.endsWith(".answer.json"));
      const id = promptFile.replace(/\.json$/, "");
      // Snapshot the prompt JSON BEFORE writing the answer (the bridge
      // deletes the prompt on answer pickup).
      const fs = require("node:fs");
      snapshot = JSON.parse(fs.readFileSync(join(promptsDir, promptFile), "utf-8"));
      writeFileSync(join(promptsDir, `${id}.answer.json`), JSON.stringify({ answer: "ok" }));
    }, 50);
    const ans = await future;
    expect(ans).toBe("ok");
    expect(snapshot).toMatchObject({
      sessionId: "abc",
      question: "Why?",
      context: { extra: 1 },
    });
    expect(snapshot.promptId).toMatch(/^prompt-/);
    expect(typeof snapshot.createdAt).toBe("string");
  });

  it("rejects when question is missing", async () => {
    await expect(askThroughBoard({})).rejects.toThrow(/question is required/);
  });
});
