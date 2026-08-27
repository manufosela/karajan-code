// KJC-TSK-0676 — Sonar as deterministic pre-gate of `kj review --staged`.
// With the brain outside the core (v4), skipping sonar is one decision away;
// hanging it off the review gate makes it a gate, not discipline.

import { describe, it, expect, vi, beforeEach } from "vitest";

const scanMock = vi.fn();
const issuesMock = vi.fn();
const lockMock = vi.fn();

vi.mock("../../src/sonar/scanner.js", () => ({ runSonarScan: (...a) => scanMock(...a) }));
vi.mock("../../src/sonar/api.js", () => ({ getOpenIssues: (...a) => issuesMock(...a) }));
vi.mock("../../src/utils/tool-governor.js", () => ({ acquireToolLock: (...a) => lockMock(...a) }));

import { runSonarPregate, addedLinesByFile } from "../../src/review/sonar-pregate.js";

describe("addedLinesByFile", () => {
  it("maps +++ b/ files to the NEW line numbers their hunks add; deletions map nothing", () => {
    const diff = [
      "diff --git a/src/a.js b/src/a.js",
      "--- a/src/a.js",
      "+++ b/src/a.js",
      "@@ -10,2 +12,3 @@ context",
      "@@ -40 +50 @@",
      "diff --git a/src/gone.js b/src/gone.js",
      "--- a/src/gone.js",
      "+++ /dev/null",
      "@@ -1,5 +0,0 @@",
    ].join("\n");
    const m = addedLinesByFile(diff);
    expect([...m.get("src/a.js")]).toEqual([12, 13, 14, 50]);
    expect(m.size).toBe(1); // a deleted file adds no lines
  });
});

const release = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  lockMock.mockResolvedValue({ release });
  scanMock.mockResolvedValue({ ok: true, projectKey: "kj-test" });
});

const issue = (file, severity, extra = {}) => ({
  component: `kj-test:${file}`, severity, rule: "js:S000", line: 7, message: "m", ...extra,
});

describe("runSonarPregate", () => {
  it("filters to staged files and splits blocking from advisory", async () => {
    issuesMock.mockResolvedValue({ total: 4, issues: [
      issue("src/a.js", "CRITICAL"),
      issue("src/a.js", "MINOR"),
      issue("src/untouched.js", "BLOCKER"),
      issue("src/b.js", "MAJOR"),
    ] });
    const r = await runSonarPregate({ config: {}, stagedFiles: ["src/a.js", "src/b.js"] });
    expect(r.available).toBe(true);
    expect(r.blocking.map((i) => i.severity)).toEqual(["CRITICAL"]);
    expect(r.advisory.map((i) => i.severity)).toEqual(["MINOR", "MAJOR"]);
    expect(r.totalProject).toBe(4);
    expect(release).toHaveBeenCalled(); // lock always released
  });

  // KJC-TSK-0795 AC3 (epic KJC-PCS-0082) — measured in GREBLA: a 3-line PR
  // listed 30+ preexisting issues and got blocked by debt it never touched.
  // Only issues on lines the diff ADDS may veto; the rest is trend, not veto.
  it("with touched lines, a BLOCKER on an untouched line is preexisting — reported, never blocking", async () => {
    issuesMock.mockResolvedValue({ total: 3, issues: [
      issue("src/a.js", "BLOCKER", { line: 7 }),
      issue("src/a.js", "BLOCKER", { line: 200 }),
      issue("src/a.js", "MINOR", { line: 8 }),
    ] });
    const touched = new Map([["src/a.js", new Set([7, 8])]]);
    const r = await runSonarPregate({ config: {}, stagedFiles: ["src/a.js"], touchedLines: touched });
    expect(r.blocking.map((i) => i.line)).toEqual([7]);
    expect(r.advisory.map((i) => i.line)).toEqual([8]);
    expect(r.preexisting.map((i) => i.line)).toEqual([200]);
  });

  it("an issue with no line never blocks — file-level debt is trend", async () => {
    issuesMock.mockResolvedValue({ total: 1, issues: [issue("src/a.js", "BLOCKER", { line: undefined })] });
    const r = await runSonarPregate({ config: {}, stagedFiles: ["src/a.js"], touchedLines: new Map([["src/a.js", new Set([1])]]) });
    expect(r.blocking).toEqual([]);
    expect(r.preexisting).toHaveLength(1);
  });

  it("without touchedLines the old behavior stands — callers that cannot compute the diff", async () => {
    issuesMock.mockResolvedValue({ total: 1, issues: [issue("src/a.js", "BLOCKER", { line: 200 })] });
    const r = await runSonarPregate({ config: {}, stagedFiles: ["src/a.js"] });
    expect(r.blocking).toHaveLength(1);
  });

  it("degrades gracefully when the scan fails or the server is down", async () => {
    scanMock.mockResolvedValue({ ok: false, stderr: "connect ECONNREFUSED" });
    const r = await runSonarPregate({ config: {}, stagedFiles: ["src/a.js"] });
    expect(r).toMatchObject({ available: false, reason: expect.stringContaining("ECONNREFUSED") });

    issuesMock.mockRejectedValue(new Error("401 auth"));
    scanMock.mockResolvedValue({ ok: true, projectKey: "kj-test" });
    const r2 = await runSonarPregate({ config: {}, stagedFiles: ["src/a.js"] });
    expect(r2.available).toBe(false);
    expect(release).toHaveBeenCalled();
  });

  it("is disabled by config without touching sonar", async () => {
    const r = await runSonarPregate({ config: { review_gate: { sonar: false } }, stagedFiles: ["src/a.js"] });
    expect(r.available).toBe(false);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("never runs two scans at once — waits on the governor lock", async () => {
    issuesMock.mockResolvedValue({ total: 0, issues: [] });
    await runSonarPregate({ config: {}, stagedFiles: [] });
    expect(lockMock).toHaveBeenCalledWith("sonar-scanner", expect.anything());
    expect(lockMock.mock.invocationCallOrder[0]).toBeLessThan(scanMock.mock.invocationCallOrder[0]);
  });
});
