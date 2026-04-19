import { describe, expect, it } from "vitest";
import {
  renderIterationEntry,
  recordIteration,
  buildIterationsMarkdown,
  extractIterationData,
} from "../../src/session/journal/iteration-logger.js";

describe("session/journal/iteration-logger — renderIterationEntry", () => {
  it("renders header with iteration number and duration", () => {
    const md = renderIterationEntry({ iteration: 1, durationMs: 42_000 });
    expect(md).toContain("## Iteration 1");
    expect(md).toContain("**Duration**: 42s");
  });

  it("formats duration as minutes+seconds when ≥ 60s", () => {
    const md = renderIterationEntry({ iteration: 1, durationMs: 125_000 });
    expect(md).toContain("2m 5s");
  });

  it("includes coder / reviewer / sonar / tester / security sections when data is provided", () => {
    const md = renderIterationEntry({
      iteration: 2,
      durationMs: 30_000,
      coderSummary: "Added auth middleware",
      reviewerSummary: "2 blocking issues",
      sonarSummary: "pragmatic gate",
      sonarIssuesFound: 5,
      sonarIssuesResolved: 3,
      testerSummary: "14/14 tests pass",
      securitySummary: "No vulnerabilities found",
    });
    expect(md).toContain("### Coder");
    expect(md).toContain("Added auth middleware");
    expect(md).toContain("### Reviewer");
    expect(md).toContain("### Sonar");
    expect(md).toContain("Issues: 5 (3 resolved)");
    expect(md).toContain("### Tester");
    expect(md).toContain("14/14 tests pass");
    expect(md).toContain("### Security");
  });

  it("renders blocking issues as a bulleted list with severity + location", () => {
    const md = renderIterationEntry({
      iteration: 3,
      durationMs: 10_000,
      blockingIssues: [
        { id: "R-1", severity: "critical", file: "src/auth.js", line: 42, description: "SQL injection vector" },
        { severity: "major", description: "missing error handling" },
      ],
    });
    expect(md).toContain("**Blocking issues**:");
    expect(md).toContain("- [critical] R-1: SQL injection vector — `src/auth.js:42`");
    expect(md).toContain("- [major] missing error handling");
  });

  it("includes a Solomon section when a ruling happened during the iteration", () => {
    const md = renderIterationEntry({
      iteration: 4,
      durationMs: 5_000,
      solomon: { ruling: "approve_with_conditions", reasoning: "style-only blocker" },
    });
    expect(md).toContain("### Solomon");
    expect(md).toContain("`approve_with_conditions`");
    expect(md).toContain("style-only blocker");
  });

  it("omits Solomon section when no ruling is present", () => {
    const md = renderIterationEntry({ iteration: 5, durationMs: 1_000 });
    expect(md).not.toContain("### Solomon");
  });

  it("escapes pipe chars in text fields", () => {
    const md = renderIterationEntry({
      iteration: 6,
      durationMs: 1_000,
      blockingIssues: [{ description: "a|b|c" }],
    });
    expect(md).toContain("a\\|b\\|c");
  });

  it("handles missing duration gracefully", () => {
    const md = renderIterationEntry({ iteration: 7, durationMs: null });
    expect(md).toContain("**Duration**: —");
  });
});

describe("session/journal/iteration-logger — recordIteration", () => {
  it("initializes session._journalIterations and appends formatted entries", () => {
    const session = {};
    recordIteration(session, { iteration: 1, durationMs: 5_000, coderSummary: "did it" });
    recordIteration(session, { iteration: 2, durationMs: 6_000, coderSummary: "did it again" });
    expect(session._journalIterations).toHaveLength(2);
    expect(session._journalIterations[0]).toContain("## Iteration 1");
    expect(session._journalIterations[0]).toContain("did it");
    expect(session._journalIterations[1]).toContain("## Iteration 2");
  });

  it("is a no-op on null session or null data", () => {
    expect(() => recordIteration(null, {})).not.toThrow();
    expect(() => recordIteration({}, null)).not.toThrow();
  });
});

describe("session/journal/iteration-logger — buildIterationsMarkdown", () => {
  it("returns null when no iterations were recorded", () => {
    expect(buildIterationsMarkdown({})).toBeNull();
    expect(buildIterationsMarkdown({ _journalIterations: [] })).toBeNull();
  });

  it("builds full markdown with header + all entries separated by ---", () => {
    const session = { id: "sX" };
    recordIteration(session, { iteration: 1, durationMs: 1000 });
    recordIteration(session, { iteration: 2, durationMs: 2000 });
    const md = buildIterationsMarkdown(session);
    expect(md).toContain("# Session iterations — sX");
    expect(md).toContain("Total iterations: **2**");
    expect(md).toContain("## Iteration 1");
    expect(md).toContain("## Iteration 2");
    expect(md).toContain("---");
  });
});

describe("session/journal/iteration-logger — extractIterationData", () => {
  it("pulls coder/reviewer/tester/security summaries from stageResults", () => {
    const stageResults = {
      coder: { summary: "coded" },
      reviewer: { summary: "reviewed", result: { blocking_issues: [{ id: "R-1", description: "x" }] } },
      tester: { summary: "tested" },
      security: { summary: "sec ok" },
      sonar: { summary: "pragmatic", issuesInitial: 3, issuesResolved: 2 },
    };
    const data = extractIterationData({ iteration: 1, durationMs: 1000, stageResults });
    expect(data.coderSummary).toBe("coded");
    expect(data.reviewerSummary).toBe("reviewed");
    expect(data.blockingIssues).toHaveLength(1);
    expect(data.testerSummary).toBe("tested");
    expect(data.securitySummary).toBe("sec ok");
    expect(data.sonarSummary).toBe("pragmatic");
    expect(data.sonarIssuesFound).toBe(3);
    expect(data.sonarIssuesResolved).toBe(2);
  });

  it("takes the iteration-matching Solomon ruling when one exists", () => {
    const session = {
      solomonRulings: [
        { iteration: 0, ruling: "x" },
        { iteration: 1, ruling: "approve_with_conditions", reasoning: "context" },
      ],
    };
    const data = extractIterationData({ iteration: 1, durationMs: 0, stageResults: {}, session });
    expect(data.solomon.ruling).toBe("approve_with_conditions");
    expect(data.solomon.reasoning).toBe("context");
  });

  it("falls back to the latest Solomon ruling when none matches the iteration", () => {
    const session = { solomonRulings: [{ ruling: "approve" }] };
    const data = extractIterationData({ iteration: 5, durationMs: 0, stageResults: {}, session });
    expect(data.solomon.ruling).toBe("approve");
  });

  it("returns undefined solomon when no rulings exist", () => {
    const data = extractIterationData({ iteration: 1, durationMs: 0, stageResults: {}, session: {} });
    expect(data.solomon).toBeUndefined();
  });

  it("derives sonar summary from openIssues when stageResult.summary absent", () => {
    const stageResults = { sonar: { openIssues: 7 } };
    const data = extractIterationData({ iteration: 1, durationMs: 0, stageResults });
    expect(data.sonarSummary).toBe("7 open issue(s)");
  });
});
