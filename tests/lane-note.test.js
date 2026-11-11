// KJC-TSK-1541 (issue 3853): kj worktree note <slug> "<what it waits for>" leaves a short note on
// a lane that kj stage shows as text, never as an instruction.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LANE_NOTES_DIR, clearLaneNote, cleanNote, noteLine, writeLaneNote } from "../src/hu/lane-note.js";

let main;
const lane = (slug) => mkdirSync(join(main, ".kj", "worktrees", slug), { recursive: true });
const noteFile = (slug) => join(main, ...LANE_NOTES_DIR, `${slug}.json`);

beforeEach(() => { main = mkdtempSync(join(tmpdir(), "kj-lane-note-")); });
afterEach(() => rmSync(main, { recursive: true, force: true }));

describe("cleanNote", () => {
  it("drops control characters, folds whitespace and cuts it to 120 characters", () => {
    expect(cleanNote("  waits\u0007 for\n\tthe   seal ")).toBe("waits for the seal");
    expect(cleanNote("x".repeat(200))).toHaveLength(120);
  });
});

describe("writeLaneNote", () => {
  it("keeps the note of a lane in the main checkout, with when it was written", () => {
    lane("pay");
    const out = writeLaneNote({ mainDir: main, slug: "pay", text: "waits for Jorge's review", now: () => "2026-11-11T10:00:00Z" });
    expect(out).toEqual({ slug: "pay", note: "waits for Jorge's review", at: "2026-11-11T10:00:00Z" });
    expect(JSON.parse(readFileSync(noteFile("pay"), "utf8"))).toEqual({ note: "waits for Jorge's review", at: "2026-11-11T10:00:00Z" });
  });

  it("an empty note clears it", () => {
    lane("pay");
    writeLaneNote({ mainDir: main, slug: "pay", text: "x" });
    expect(writeLaneNote({ mainDir: main, slug: "pay", text: "  " })).toEqual({ slug: "pay", note: null });
    expect(() => readFileSync(noteFile("pay"))).toThrow();
  });

  it("kj worktree note says what it left", () => {
    lane("pay");
    expect(noteLine(writeLaneNote({ mainDir: main, slug: "pay", text: "waits" }))).toBe("✓ note on pay: waits");
    expect(noteLine(writeLaneNote({ mainDir: main, slug: "pay", text: "" }))).toBe("✓ note of pay cleared");
  });

  it("a retired lane, or a new one of its slug, loses the old note", () => {
    lane("pay");
    writeLaneNote({ mainDir: main, slug: "pay", text: "old" });
    clearLaneNote(main, "pay");
    expect(() => readFileSync(noteFile("pay"))).toThrow();
    expect(() => clearLaneNote(main, "../x")).not.toThrow();
  });

  it("refuses a slug that is not a lane, or that could leave the notes folder", () => {
    expect(() => writeLaneNote({ mainDir: main, slug: "ghost", text: "x" })).toThrow(/no lane "ghost"/);
    expect(() => writeLaneNote({ mainDir: main, slug: "../x", text: "x" })).toThrow(/invalid slug/);
  });
});
