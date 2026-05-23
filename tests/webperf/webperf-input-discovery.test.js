import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { collectWebPerfInput } from "../../src/audit/webperf-input.js";

// Verifies the new lastResultPath / fallback discovery logic added in
// KJC-TSK-0149 so `kj audit` reads the file `kj webperf` writes.

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-webperf-input-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sampleScan = {
  url: "http://localhost:3000",
  capturedAt: "2026-05-04T22:00:00Z",
  metrics: { lcp: 5000, cls: 0.05, inp: 250 },
  cwv: {
    pass: false,
    scores: { lcp: { value: 5000, rating: "poor" } },
    blocking: [{ metric: "lcp", value: 5000, threshold: 4000, rating: "poor" }],
    advisory: [],
  },
};

describe("collectWebPerfInput — persisted scan discovery (KJC-TSK-0149 wiring)", () => {
  it("picks up an explicit config.webperf.lastResultPath", () => {
    const target = path.join(tmpDir, "scan.json");
    fs.writeFileSync(target, JSON.stringify(sampleScan));

    const r = collectWebPerfInput(
      { isFrontend: true, isBackend: false, isFullstack: false },
      { webperf: { lastResultPath: target } }
    );
    expect(r.available).toBe(true);
    expect(r.mode).toBe("cwv-result");
    expect(r.url).toBe("http://localhost:3000");
    expect(r.cwv.pass).toBe(false);
  });

  it("falls back to ~/.karajan/webperf/<slug>/last.json discovery via projectDir", () => {
    // KJC-TSK-0420: webperf-input now resolves via paths.js which
    // honours KARAJAN_HOME with priority over the VITEST tmp dir;
    // set KARAJAN_HOME so the fallback path lands inside our tmp.
    const originalEnv = process.env.HOME;
    const originalKarajanHome = process.env.KARAJAN_HOME;
    process.env.HOME = tmpDir;
    process.env.KARAJAN_HOME = path.join(tmpDir, ".karajan");
    try {
      const projectDir = path.join(tmpDir, "my-project");
      fs.mkdirSync(projectDir, { recursive: true });
      const slug = path.basename(projectDir).replace(/[^a-zA-Z0-9_-]/g, "_");
      const fallbackDir = path.join(tmpDir, ".karajan", "webperf", slug);
      fs.mkdirSync(fallbackDir, { recursive: true });
      fs.writeFileSync(path.join(fallbackDir, "last.json"), JSON.stringify(sampleScan));

      const r = collectWebPerfInput(
        { isFrontend: true, isBackend: false, isFullstack: false },
        { projectDir, webperf: {} }
      );
      expect(r.available).toBe(true);
      expect(r.mode).toBe("cwv-result");
      expect(r.url).toBe("http://localhost:3000");
    } finally {
      process.env.HOME = originalEnv;
      if (originalKarajanHome === undefined) delete process.env.KARAJAN_HOME;
      else process.env.KARAJAN_HOME = originalKarajanHome;
    }
  });

  it("inline config.webperf.lastResult still works (back-compat)", () => {
    const r = collectWebPerfInput(
      null,
      { webperf: { lastResult: { metrics: { lcp: 1000, cls: 0.05, inp: 100 } } } }
    );
    expect(r.available).toBe(true);
    expect(r.mode).toBe("cwv-result");
    expect(r.cwv.pass).toBe(true); // good thresholds across the board
  });

  it("falls through to static-hints when persisted file is missing", () => {
    const r = collectWebPerfInput(
      { isFrontend: true, isBackend: false, isFullstack: false },
      { webperf: { lastResultPath: path.join(tmpDir, "does-not-exist.json") } }
    );
    expect(r.available).toBe(true);
    expect(r.mode).toBe("static-hints");
  });

  it("falls through to static-hints when persisted file is unparseable", () => {
    const target = path.join(tmpDir, "garbage.json");
    fs.writeFileSync(target, "not json {{{");

    const r = collectWebPerfInput(
      { isFrontend: true, isBackend: false, isFullstack: false },
      { webperf: { lastResultPath: target } }
    );
    expect(r.available).toBe(true);
    expect(r.mode).toBe("static-hints");
  });
});
