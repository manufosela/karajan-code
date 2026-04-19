import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  writeDecisionsJournal,
  buildDecisionsMarkdown,
  recordSolomonRuling,
} from "../../src/session/journal/decisions-writer.js";

/**
 * Integration scenarios for the decisions.md journal:
 *   - session with 0 Solomon invocations → no file
 *   - session with 1 invocation → file exists with expected shape
 *   - Brain decisions are appended when present
 *   - integrates with options.journalDir (the path used by the existing
 *     session-journal infrastructure)
 */

describe("decisions journal integration", () => {
  const cleanups = [];

  afterEach(async () => {
    for (const p of cleanups) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    cleanups.length = 0;
  });

  async function mkTmpDir() {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "kj-journal-integ-"));
    cleanups.push(d);
    return d;
  }

  it("AC: session where Solomon was NOT invoked → decisions.md is NOT created", async () => {
    const journalDir = await mkTmpDir();
    const session = {
      id: "s-no-solomon",
      solomonRulings: [], // explicit empty
      brainDecisions: [
        { seq: 1, at: "2026-04-19T11:00:00.000Z", intent: "sw:simple", rolesOn: ["coder"], confidence: "high", rationale: "r", appliedOverrides: [] }
      ],
    };
    const result = await writeDecisionsJournal(session, { journalDir });
    expect(result.written).toBe(false);
    const files = await fs.readdir(journalDir);
    expect(files).not.toContain("decisions.md");
  });

  it("AC: session where Solomon was invoked once → decisions.md exists with expected fields", async () => {
    const journalDir = await mkTmpDir();
    const session = { id: "s-with-solomon" };
    recordSolomonRuling(session, {
      stage: "reviewer",
      trigger: "reviewer retry exhausted",
      conflict: { task: "add rate limiter", reason: "style-only blocker", summary: "3 iterations" },
      ruling: "approve_with_conditions",
      reasoning: "Stylistic objections don't block correctness.",
      conditions: ["open follow-up for naming"],
    });
    const result = await writeDecisionsJournal(session, { journalDir });
    expect(result.written).toBe(true);
    const content = await fs.readFile(result.path, "utf8");
    expect(content).toContain("# Session decisions — s-with-solomon");
    expect(content).toContain("Solomon invocations: **1**");
    expect(content).toContain("approve_with_conditions");
    expect(content).toContain("**Stage**: reviewer");
    expect(content).toContain("**Trigger**: reviewer retry exhausted");
    expect(content).toContain("Stylistic objections don't block correctness.");
    expect(content).toContain("- open follow-up for naming");
  });

  it("multi-ruling session: each ruling is rendered as its own subsection separated by ---", async () => {
    const session = { id: "s-multi" };
    recordSolomonRuling(session, { stage: "reviewer", trigger: "first", conflict: { reason: "a" }, ruling: "approve", reasoning: "reason-1" });
    recordSolomonRuling(session, { stage: "coder", trigger: "second", conflict: { reason: "b" }, ruling: "escalate_human", reasoning: "reason-2" });
    const md = buildDecisionsMarkdown(session);
    expect(md).toContain("Solomon invocations: **2**");
    expect(md).toContain("reason-1");
    expect(md).toContain("reason-2");
    expect(md.split("\n---\n\n").length).toBeGreaterThanOrEqual(3); // header --- + between rulings
  });

  it("session with both Solomon rulings and Brain decisions includes both sections", async () => {
    const journalDir = await mkTmpDir();
    const session = {
      id: "s-both",
      brainDecisions: [
        { seq: 1, at: "2026-04-19T10:00:00.000Z", intent: "refactor:medium", rolesOn: ["coder", "reviewer", "refactorer"], confidence: "high", rationale: "level=medium | taskType=refactor", appliedOverrides: [] }
      ],
    };
    recordSolomonRuling(session, { stage: "reviewer", trigger: "retry", conflict: { reason: "style" }, ruling: "approve", reasoning: "style-only" });
    const result = await writeDecisionsJournal(session, { journalDir });
    const content = await fs.readFile(result.path, "utf8");
    expect(content).toContain("## Solomon rulings");
    expect(content).toContain("## Brain routing decisions");
    expect(content).toContain("refactor:medium");
  });

  it("falls back gracefully when the journal directory is not writable", async () => {
    const session = { id: "s-ro" };
    recordSolomonRuling(session, { stage: "reviewer", trigger: "x", conflict: {}, ruling: "approve", reasoning: "y" });
    const tmp = await mkTmpDir();
    // Path under an existing file is not usable as a directory.
    await fs.writeFile(path.join(tmp, "blocker"), "stub");
    const badDir = path.join(tmp, "blocker", "under-a-file");
    const logger = { info: () => {}, warn: () => {} };
    const result = await writeDecisionsJournal(session, { journalDir: badDir, logger });
    expect(result.written).toBe(false);
    expect(result.path).toBeNull();
  });
});
