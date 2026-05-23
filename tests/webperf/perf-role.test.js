import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PerfRole } from "../../src/roles/perf-role.js";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn() };

const passingScan = {
  ok: true,
  url: "http://localhost:3000",
  preset: "desktop",
  capturedAt: "2026-05-04T22:00:00Z",
  performanceScore: 92,
  metrics: { lcp: 1500, cls: 0.05, inp: 100 },
  cwv: { pass: true, scores: { lcp: { value: 1500, rating: "good" } }, blocking: [], advisory: [] },
  issues: [],
  thresholds: { lcp: { good: 2500, poor: 4000 } },
};

const failingScan = {
  ...passingScan,
  performanceScore: 35,
  metrics: { lcp: 5500, cls: 0.05, inp: 250 },
  cwv: {
    pass: false,
    scores: { lcp: { value: 5500, rating: "poor" } },
    blocking: [{ metric: "lcp", value: 5500, threshold: 4000, rating: "poor" }],
    advisory: [],
  },
  issues: [
    { id: "render-blocking-resources", title: "Eliminate render-blocking", score: 0.3, severity: "high" },
  ],
};

let tmpHome, tmpProject, originalHome, originalKarajanHome;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "kj-perf-role-"));
  tmpProject = path.join(tmpHome, "my-app");
  await fs.mkdir(tmpProject, { recursive: true });
  // KJC-TSK-0420: perf-role::defaultPersistDir() now resolves via
  // src/utils/paths.js, which respects KARAJAN_HOME with priority over
  // the VITEST tmp dir. Set both for hermetic test isolation.
  originalHome = process.env.HOME;
  originalKarajanHome = process.env.KARAJAN_HOME;
  process.env.HOME = tmpHome;
  process.env.KARAJAN_HOME = path.join(tmpHome, ".karajan");
});

afterEach(async () => {
  process.env.HOME = originalHome;
  if (originalKarajanHome === undefined) delete process.env.KARAJAN_HOME;
  else process.env.KARAJAN_HOME = originalKarajanHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

function makeConfig(overrides = {}) {
  return {
    projectDir: tmpProject,
    webperf: { url: "http://localhost:3000", ...(overrides.webperf || {}) },
    ...overrides,
  };
}

describe("PerfRole (KJC-TSK-0150)", () => {
  it("skips with a clear summary when config.webperf.url is missing", async () => {
    const role = new PerfRole({ config: { projectDir: tmpProject, webperf: {} }, logger: noopLogger, scanFn: vi.fn() });
    const r = await role.execute();

    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/no config\.webperf\.url/);
    expect(role._scan).not.toHaveBeenCalled();
  });

  it("returns ok=true and a passing summary when CWV verdict is PASS", async () => {
    const scanFn = vi.fn().mockResolvedValue(passingScan);
    const role = new PerfRole({ config: makeConfig(), logger: noopLogger, scanFn });
    const r = await role.execute();

    expect(r.ok).toBe(true);
    expect(r.summary).toContain("Webperf PASS");
    expect(r.summary).toContain("score 92/100");
    expect(r.result.cwv.pass).toBe(true);
    expect(r.result.url).toBe("http://localhost:3000");
  });

  it("returns ok=false with blocking metrics in the summary on FAIL verdict", async () => {
    const scanFn = vi.fn().mockResolvedValue(failingScan);
    const role = new PerfRole({ config: makeConfig(), logger: noopLogger, scanFn });
    const r = await role.execute();

    expect(r.ok).toBe(false);
    expect(r.summary).toContain("Webperf FAIL");
    expect(r.summary).toContain("LCP=5500");
    expect(r.result.issues).toHaveLength(1);
  });

  it("returns ok=false with reason when scanner itself fails (lighthouse not installed)", async () => {
    const scanFn = vi.fn().mockResolvedValue({ ok: false, reason: "lighthouse not installed" });
    const role = new PerfRole({ config: makeConfig(), logger: noopLogger, scanFn });
    const r = await role.execute();

    expect(r.ok).toBe(false);
    expect(r.summary).toContain("Webperf scan failed");
    expect(r.result.error).toContain("not installed");
  });

  it("forwards preset + thresholds from config to the scanner", async () => {
    const scanFn = vi.fn().mockResolvedValue(passingScan);
    const customThresholds = { lcp: { good: 1500, poor: 3000 } };
    const role = new PerfRole({
      config: makeConfig({ webperf: { url: "http://localhost:3000", preset: "mobile", thresholds: customThresholds } }),
      logger: noopLogger,
      scanFn,
    });
    await role.execute();

    expect(scanFn).toHaveBeenCalledWith(
      "http://localhost:3000",
      expect.objectContaining({ preset: "mobile", thresholds: customThresholds })
    );
  });

  it("persists the result to ~/.karajan/webperf/<slug>/last.json by default", async () => {
    const scanFn = vi.fn().mockResolvedValue(passingScan);
    const role = new PerfRole({ config: makeConfig(), logger: noopLogger, scanFn });
    const r = await role.execute();

    expect(r.result.savedPath).toBeTruthy();
    const slug = path.basename(tmpProject).replace(/[^a-zA-Z0-9_-]/g, "_");
    const expected = path.join(tmpHome, ".karajan", "webperf", slug, "last.json");
    expect(r.result.savedPath).toBe(expected);
    const written = JSON.parse(await fs.readFile(expected, "utf8"));
    expect(written.url).toBe("http://localhost:3000");
  });

  it("respects config.webperf.persist=false (no disk write)", async () => {
    const scanFn = vi.fn().mockResolvedValue(passingScan);
    const role = new PerfRole({
      config: makeConfig({ webperf: { url: "http://localhost:3000", persist: false } }),
      logger: noopLogger,
      scanFn,
    });
    const r = await role.execute();

    expect(r.result.savedPath).toBeNull();
    const slug = path.basename(tmpProject).replace(/[^a-zA-Z0-9_-]/g, "_");
    const target = path.join(tmpHome, ".karajan", "webperf", slug, "last.json");
    await expect(fs.access(target)).rejects.toThrow();
  });
});
