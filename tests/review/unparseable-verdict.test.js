// KJC-BUG-0146 — eight "no parseable verdict" in two days and not one byte of
// evidence, because the reviewer's answer was thrown away with the error. Here
// the answer survives: an excerpt in the message and the whole thing on disk.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reportUnparseableVerdict, describeOutput } from "../../src/review/unparseable-verdict.js";

let dir;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-unparseable-")); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe("an unreadable verdict leaves evidence", () => {
  it("saves the whole answer next to the verdicts and puts an excerpt in the error", async () => {
    const output = `I reviewed the diff.\n${"x".repeat(900)}\nLooks fine to me.`;
    const message = await reportUnparseableVerdict({ projectDir: dir, reviewer: "codex", output, hash: "abc123" });
    const saved = await fs.readFile(path.join(dir, ".karajan", "reviews", "abc123.unparseable.txt"), "utf8");
    expect(saved).toContain("reviewer: codex");
    expect(saved).toContain(output); // the WHOLE answer, not the excerpt
    expect(message).toContain(".karajan/reviews/abc123.unparseable.txt");
    expect(message).toContain("I reviewed the diff.");
    expect(message.length).toBeLessThan(output.length); // an excerpt, not a wall of text
  });

  it("says an unreadable answer is a refusal, never a pass", async () => {
    const message = await reportUnparseableVerdict({ projectDir: dir, reviewer: "codex", output: "REJECTED: leaks a token", hash: "h" });
    expect(message).toMatch(/refusal, not a pass/);
    expect(message).toContain("REJECTED: leaks a token"); // exactly the case that must not be auto-retried elsewhere
  });

  it("describes the shape of what came back, including the cases with nothing to excerpt", async () => {
    expect(describeOutput(undefined)).toBe("no output at all");
    expect(describeOutput({ approved: true })).toMatch(/object, not a string/);
    expect(describeOutput("   ")).toBe("empty output");
    expect(describeOutput("hello")).toMatch(/^5 chars, starts with "hello"/);
    const message = await reportUnparseableVerdict({ projectDir: dir, reviewer: "codex", output: "", hash: "h" });
    expect(message).toContain("empty output");
    expect(message).not.toContain("--- what"); // nothing to show, so no empty excerpt block
  });

  it("if it cannot be saved, it says so instead of hiding the original failure", async () => {
    const message = await reportUnparseableVerdict({
      projectDir: dir, reviewer: "codex", output: "something", hash: "h",
      writeFile: async () => { throw new Error("disk full"); },
    });
    expect(message).toContain("could NOT be saved to disk");
    expect(message).toContain("no parseable verdict");
    expect(message).toContain("something");
  });
});
