import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildDecisionsMarkdown,
  writeDecisionsJournal,
  recordSolomonRuling,
} from "../../src/session/journal/decisions-writer.js";

function sampleRuling(overrides = {}) {
  return {
    at: "2026-04-19T11:00:00.000Z",
    stage: "reviewer",
    trigger: "reviewer retry exhausted",
    conflict: { task: "add X", reason: "style-only", summary: "3 iterations, same blocker" },
    ruling: "approve_with_conditions",
    reasoning: "The blocker is stylistic; code is correct. Ship with a follow-up task.",
    conditions: ["create follow-up task for naming"],
    alternativeAgent: null,
    result: "pipeline continued with conditions",
    ...overrides,
  };
}

describe("session/journal/decisions-writer — buildDecisionsMarkdown", () => {
  it("returns null when there are NO Solomon rulings (AC: file not generated)", () => {
    const md = buildDecisionsMarkdown({ id: "s1", solomonRulings: [], brainDecisions: [{ seq: 1, at: "x", intent: "sw:simple", rolesOn: [], confidence: "high", rationale: "" }] });
    expect(md).toBeNull();
  });

  it("returns null when session has no solomonRulings field at all", () => {
    expect(buildDecisionsMarkdown({ id: "s1" })).toBeNull();
    expect(buildDecisionsMarkdown({})).toBeNull();
  });

  it("renders a Solomon ruling with all standard fields", () => {
    const md = buildDecisionsMarkdown({ id: "s-test", solomonRulings: [sampleRuling()] });
    expect(md).toContain("# Session decisions — s-test");
    expect(md).toContain("## Solomon rulings");
    expect(md).toContain("Solomon @ 2026-04-19T11:00:00.000Z");
    expect(md).toContain("approve_with_conditions");
    expect(md).toContain("**Stage**: reviewer");
    expect(md).toContain("**Trigger**: reviewer retry exhausted");
    expect(md).toContain("style-only");
    expect(md).toContain("pipeline continued with conditions");
    expect(md).toContain("- create follow-up task for naming");
  });

  it("includes Brain routing section when brainDecisions are present", () => {
    const md = buildDecisionsMarkdown({
      id: "s2",
      solomonRulings: [sampleRuling()],
      brainDecisions: [{
        seq: 1,
        at: "2026-04-19T10:55:00.000Z",
        intent: "refactor:medium",
        rolesOn: ["coder", "reviewer", "tester", "refactorer"],
        confidence: "high",
        rationale: "level=medium | taskType=refactor",
        appliedOverrides: [],
      }],
    });
    expect(md).toContain("## Brain routing decisions");
    expect(md).toContain("Brain @ 2026-04-19T10:55:00.000Z — refactor:medium");
    expect(md).toContain("coder, reviewer, tester, refactorer");
  });

  it("omits the Brain section when brainDecisions is empty", () => {
    const md = buildDecisionsMarkdown({ id: "s3", solomonRulings: [sampleRuling()] });
    expect(md).not.toContain("## Brain routing decisions");
  });

  it("summary counts match actual list lengths", () => {
    const md = buildDecisionsMarkdown({
      id: "s4",
      solomonRulings: [sampleRuling(), sampleRuling({ at: "x2" })],
      brainDecisions: [
        { seq: 1, at: "x", intent: "sw:simple", rolesOn: [], confidence: "high", rationale: "r", appliedOverrides: [] },
      ],
    });
    expect(md).toContain("Solomon invocations: **2**");
    expect(md).toContain("Brain routing decisions: **1**");
  });

  it("escapes pipe characters to not break Markdown tables when they appear in text", () => {
    const ruling = sampleRuling({ conflict: { reason: "a|b|c" } });
    const md = buildDecisionsMarkdown({ id: "s5", solomonRulings: [ruling] });
    expect(md).toContain("a\\|b\\|c");
  });

  it("truncates very long task text to 200 chars + ellipsis", () => {
    // A 3000-char task → the markdown still shows only the first 200 chars + "…".
    const longTask = "abc".repeat(1000); // 3000 chars
    const ruling = sampleRuling({ conflict: { task: longTask } });
    const md = buildDecisionsMarkdown({ id: "s6", solomonRulings: [ruling] });
    expect(md).toContain("…");
    // The task itself does NOT appear verbatim in the output.
    expect(md).not.toContain(longTask);
  });
});

describe("session/journal/decisions-writer — writeDecisionsJournal", () => {
  const cleanups = [];

  afterEach(async () => {
    for (const p of cleanups) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    cleanups.length = 0;
  });

  it("returns { written: false, path: null } when no Solomon rulings", async () => {
    const result = await writeDecisionsJournal({ id: "s-empty", solomonRulings: [] });
    expect(result.written).toBe(false);
    expect(result.path).toBeNull();
  });

  it("writes decisions.md inside the session directory when there are rulings", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-journal-"));
    cleanups.push(tmp);
    const result = await writeDecisionsJournal(
      { id: "abc", solomonRulings: [sampleRuling()] },
      { sessionRoot: tmp }
    );
    expect(result.written).toBe(true);
    expect(result.path).toBe(path.join(tmp, "abc", "decisions.md"));
    const content = await fs.readFile(result.path, "utf8");
    expect(content).toContain("# Session decisions — abc");
  });

  it("returns written:false when fs write fails (non-blocking)", async () => {
    // Create a read-only temp directory by chmod, then target a subdir there.
    // This is faster than relying on /proc or Windows paths.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-journal-ro-"));
    cleanups.push(tmp);
    // Make a path that's definitively unusable: a file masquerading as a dir.
    await fs.writeFile(path.join(tmp, "blocker"), "file");
    const badRoot = path.join(tmp, "blocker", "under-a-file");
    const logger = { info: vi.fn(), warn: vi.fn() };
    const result = await writeDecisionsJournal(
      { id: "x", solomonRulings: [sampleRuling()] },
      { sessionRoot: badRoot, logger }
    );
    expect(result.written).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  }, 10000);
});

describe("session/journal/decisions-writer — recordSolomonRuling", () => {
  it("creates session.solomonRulings on first call", () => {
    const session = {};
    recordSolomonRuling(session, sampleRuling());
    expect(session.solomonRulings).toHaveLength(1);
    expect(session.solomonRulings[0].ruling).toBe("approve_with_conditions");
  });

  it("appends to an existing array", () => {
    const session = { solomonRulings: [sampleRuling()] };
    recordSolomonRuling(session, sampleRuling({ ruling: "escalate_human" }));
    expect(session.solomonRulings).toHaveLength(2);
    expect(session.solomonRulings[1].ruling).toBe("escalate_human");
  });

  it("auto-fills timestamp when not provided", () => {
    const session = {};
    recordSolomonRuling(session, { stage: "x", ruling: "approve" });
    expect(session.solomonRulings[0].at).toBeTruthy();
    expect(Date.parse(session.solomonRulings[0].at)).not.toBeNaN();
  });

  it("deep-copies conditions so later mutations don't leak", () => {
    const session = {};
    const conditions = ["a"];
    recordSolomonRuling(session, { ...sampleRuling(), conditions });
    conditions.push("b");
    expect(session.solomonRulings[0].conditions).toEqual(["a"]);
  });

  it("is a no-op on null session (defensive)", () => {
    expect(() => recordSolomonRuling(null, sampleRuling())).not.toThrow();
  });
});
