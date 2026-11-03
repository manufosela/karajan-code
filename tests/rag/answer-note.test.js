// KJC-BUG-0486 (#3308): kj rag query notes what it answered, so the Sentinel's rag-first
// ledger counts the query even when the agent filters its output.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { noteRagAnswer } from "../../src/rag/answer-note.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-answer-note-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("noteRagAnswer", () => {
  it("writes the query and its sources in a kj project", () => {
    fs.mkdirSync(path.join(dir, ".karajan"));
    noteRagAnswer({ projectDir: dir, text: "what does src/a.js do", hits: [{ source: "/p/src/a.js" }, { source: "/p/src/a.js" }, { source: "/p/b.md" }], now: 42 });
    const note = JSON.parse(fs.readFileSync(path.join(dir, ".karajan", "harness", "rag-answer.json"), "utf8"));
    expect(note).toEqual({ at: 42, text: "what does src/a.js do", sources: ["/p/src/a.js", "/p/b.md"] });
  });

  it("writes nothing outside a kj project", () => {
    noteRagAnswer({ projectDir: dir, text: "q", hits: [{ source: "/p/a.js" }] });
    expect(fs.existsSync(path.join(dir, ".karajan"))).toBe(false);
  });
});
