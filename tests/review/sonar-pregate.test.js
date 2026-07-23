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

import { runSonarPregate } from "../../src/review/sonar-pregate.js";

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
