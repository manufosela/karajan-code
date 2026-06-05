import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

const scanMock = vi.fn();

vi.mock("../../src/webperf/scanner.js", () => ({ runWebperfScan: (...args) => scanMock(...args) }));
vi.mock("../../src/utils/cli-run-log.js", () => ({
  withCliRunLog: vi.fn(async (_name, _opts, fn) => {
    const runLog = { logText: vi.fn(), logEvent: vi.fn(), close: vi.fn() };
    return fn({ runLog, forwardProgress: vi.fn() });
  }),
}));

const noopLogger = createNoopLoggerWithContext();

const passingScan = {
  ok: true,
  url: "http://localhost:3000",
  preset: "desktop",
  capturedAt: "2026-05-04T22:00:00Z",
  lighthouseVersion: "11.4.0",
  performanceScore: 92,
  metrics: { lcp: 1500, cls: 0.05, inp: 100 },
  cwv: { pass: true, scores: { lcp: { value: 1500, rating: "good" } }, blocking: [], advisory: [] },
  issues: [],
};

const failingScan = {
  ...passingScan,
  performanceScore: 45,
  metrics: { lcp: 5000, cls: 0.05, inp: 250 },
  cwv: {
    pass: false,
    scores: { lcp: { value: 5000, rating: "poor" } },
    blocking: [{ metric: "lcp", value: 5000, threshold: 4000, rating: "poor" }],
    advisory: [],
  },
  issues: [
    { id: "render-blocking-resources", title: "Eliminate render-blocking", score: 0.3, savingsMs: 800, severity: "high" },
  ],
};

let tmpHome, tmpProject, originalHome, originalKarajanHome;
let consoleSpy;

beforeEach(async () => {
  vi.resetAllMocks();
  scanMock.mockResolvedValue(passingScan);
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "kj-webperf-cmd-"));
  tmpProject = path.join(tmpHome, "my-project");
  await fs.mkdir(tmpProject, { recursive: true });
  // KJC-TSK-0420: defaultReportDir() now goes through paths.js which
  // honours KARAJAN_HOME with priority over the VITEST tmp dir.
  originalHome = process.env.HOME;
  originalKarajanHome = process.env.KARAJAN_HOME;
  process.env.HOME = tmpHome;
  process.env.KARAJAN_HOME = path.join(tmpHome, ".karajan");
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  consoleSpy.mockRestore();
  process.env.HOME = originalHome;
  if (originalKarajanHome === undefined) delete process.env.KARAJAN_HOME;
  else process.env.KARAJAN_HOME = originalKarajanHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

function makeConfig() { return { projectDir: tmpProject }; }

describe("kj webperf command (KJC-TSK-0149)", () => {
  it("requires a URL", async () => {
    const { webperfCommand } = await import("../../src/commands/webperf.js");
    await expect(
      webperfCommand({ url: null, config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow(/url.*required/i);
  });

  it("prints human-readable report by default and exits ok=true on PASS verdict", async () => {
    const { webperfCommand } = await import("../../src/commands/webperf.js");
    const r = await webperfCommand({ url: "http://localhost:3000", config: makeConfig(), logger: noopLogger });

    expect(r.ok).toBe(true);
    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(stdout).toContain("## WebPerf Scan");
    expect(stdout).toContain("Verdict: PASS");
    expect(stdout).toContain("Performance score: 92/100");
  });

  it("returns ok=false (non-zero exit) on FAIL verdict", async () => {
    scanMock.mockResolvedValueOnce(failingScan);
    const { webperfCommand } = await import("../../src/commands/webperf.js");
    const r = await webperfCommand({ url: "http://localhost:3000", config: makeConfig(), logger: noopLogger });

    expect(r.ok).toBe(false);
    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(stdout).toContain("Verdict: FAIL");
    expect(stdout).toContain("render-blocking-resources");
    expect(stdout).toContain("(saves ~800ms)");
  });

  it("--json emits raw JSON", async () => {
    const { webperfCommand } = await import("../../src/commands/webperf.js");
    await webperfCommand({ url: "http://localhost:3000", config: makeConfig(), logger: noopLogger, json: true });

    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    const parsed = JSON.parse(stdout);
    expect(parsed.cwv.pass).toBe(true);
    expect(parsed.url).toBe("http://localhost:3000");
  });

  it("--mobile passes the mobile preset to the scanner", async () => {
    const { webperfCommand } = await import("../../src/commands/webperf.js");
    await webperfCommand({ url: "http://localhost:3000", config: makeConfig(), logger: noopLogger, mobile: true });

    expect(scanMock).toHaveBeenCalledWith("http://localhost:3000", expect.objectContaining({ preset: "mobile" }));
  });

  it("persists the result to ~/.karajan/webperf/<slug>/last.json", async () => {
    const { webperfCommand } = await import("../../src/commands/webperf.js");
    await webperfCommand({ url: "http://localhost:3000", config: makeConfig(), logger: noopLogger });

    const slug = path.basename(tmpProject).replace(/[^a-zA-Z0-9_-]/g, "_");
    const expected = path.join(tmpHome, ".karajan", "webperf", slug, "last.json");
    const written = JSON.parse(await fs.readFile(expected, "utf8"));
    expect(written.url).toBe("http://localhost:3000");
    expect(written.cwv.pass).toBe(true);
  });

  it("--no-persist skips the disk write", async () => {
    const { webperfCommand } = await import("../../src/commands/webperf.js");
    await webperfCommand({ url: "http://localhost:3000", config: makeConfig(), logger: noopLogger, persist: false });

    const slug = path.basename(tmpProject).replace(/[^a-zA-Z0-9_-]/g, "_");
    const target = path.join(tmpHome, ".karajan", "webperf", slug, "last.json");
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("returns ok=false with reason when scanner returns ok=false", async () => {
    scanMock.mockResolvedValueOnce({ ok: false, reason: "lighthouse not installed" });
    const { webperfCommand } = await import("../../src/commands/webperf.js");
    const r = await webperfCommand({ url: "http://localhost:3000", config: makeConfig(), logger: noopLogger });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not installed/);
    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(stdout).toContain("WebPerf scan FAILED");
  });

  it("end-to-end: kj webperf writes a scan that kj audit reads as cwv-result", async () => {
    // Step 1: run webperf, persist
    const { webperfCommand } = await import("../../src/commands/webperf.js");
    await webperfCommand({ url: "http://localhost:3000", config: makeConfig(), logger: noopLogger });

    // Step 2: run collectWebPerfInput against the same projectDir
    const { collectWebPerfInput } = await import("../../src/audit/webperf-input.js");
    const r = collectWebPerfInput(
      { isFrontend: true, isBackend: false, isFullstack: false },
      { projectDir: tmpProject, webperf: {} }
    );
    expect(r.available).toBe(true);
    expect(r.mode).toBe("cwv-result");
    expect(r.url).toBe("http://localhost:3000");
  });
});
