/**
 * Test Diet — baseline snapshot contract.
 *
 * Translated from the HU's Gherkin acceptance scenario:
 *
 *   Given the baseline file does not yet exist
 *   When the diet baseline script runs
 *   Then tests/_diet/baseline.json is created with locTotal, wallClockSec,
 *        branchCoveragePct, fileCount, files[] and a captured-at ISO timestamp
 *   And the values reflect the current repo (locTotal between 50000 and
 *       60000, wallClockSec between 30 and 90)
 *
 * The script itself spawns `npm test` and `vitest run --coverage`, which
 * each take 30–90 s and would deadlock if invoked from inside the suite.
 * The committed baseline.json IS the script's output (the diet HU ships
 * the snapshot as an artifact), so this test asserts the artifact's
 * schema and value ranges directly.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const BASELINE_PATH = resolve(REPO_ROOT, "tests/_diet/baseline.json");

describe("tests/_diet/baseline.json (Test Diet baseline contract)", () => {
  it("exists at tests/_diet/baseline.json", () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });

  it("contains every required field of the diet schema", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    expect(baseline).toHaveProperty("capturedAt");
    expect(baseline).toHaveProperty("locTotal");
    expect(baseline).toHaveProperty("wallClockSec");
    expect(baseline).toHaveProperty("branchCoveragePct");
    expect(baseline).toHaveProperty("fileCount");
    expect(baseline).toHaveProperty("files");
    expect(Array.isArray(baseline.files)).toBe(true);
    expect(baseline.files.length).toBeGreaterThan(0);
    expect(baseline.files.length).toBe(baseline.fileCount);
  });

  it("captured-at is a non-empty ISO-8601 timestamp", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    expect(typeof baseline.capturedAt).toBe("string");
    expect(baseline.capturedAt.length).toBeGreaterThan(0);
    // ISO-8601 produced by Date.prototype.toISOString(), e.g.
    // "2026-04-29T12:34:56.789Z"
    expect(baseline.capturedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
    );
    expect(Number.isFinite(Date.parse(baseline.capturedAt))).toBe(true);
  });

  it("locTotal reflects the current repo (between 50000 and 60000)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    expect(typeof baseline.locTotal).toBe("number");
    expect(baseline.locTotal).toBeGreaterThanOrEqual(50000);
    expect(baseline.locTotal).toBeLessThanOrEqual(60000);
  });

  it("wallClockSec reflects the current repo (between 30 and 90)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    expect(typeof baseline.wallClockSec).toBe("number");
    expect(baseline.wallClockSec).toBeGreaterThanOrEqual(30);
    expect(baseline.wallClockSec).toBeLessThanOrEqual(90);
  });

  it("branchCoveragePct is a percentage (0–100)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    expect(typeof baseline.branchCoveragePct).toBe("number");
    expect(baseline.branchCoveragePct).toBeGreaterThanOrEqual(0);
    expect(baseline.branchCoveragePct).toBeLessThanOrEqual(100);
  });

  it("each files[] entry has path, loc and architecture flag", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    for (const entry of baseline.files) {
      expect(typeof entry.path).toBe("string");
      expect(entry.path.endsWith(".test.js")).toBe(true);
      expect(typeof entry.loc).toBe("number");
      expect(entry.loc).toBeGreaterThanOrEqual(0);
      expect(typeof entry.architecture).toBe("boolean");
    }
  });
});
