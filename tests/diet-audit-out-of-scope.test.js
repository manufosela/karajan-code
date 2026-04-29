/**
 * Test Diet — audit script OUT_OF_SCOPE contract.
 *
 * Translated from the HU's Gherkin acceptance scenario:
 *
 *   Given a test file under tests/architecture/
 *   When the audit script runs
 *   Then that file appears with classification "OUT_OF_SCOPE" and is
 *        excluded from the candidate count
 *
 * The test invokes `tests/_diet/audit.mjs` against a temporary output file
 * (so the committed audit.json is not touched) and verifies:
 *   - Every test file under tests/architecture/ ends up in `outOfScope[]`
 *     with classification === "OUT_OF_SCOPE".
 *   - None of those files appear in `files[]` (the candidate set).
 *   - `totals.candidateCount` equals `files.length` and excludes architecture
 *     files entirely.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const AUDIT_SCRIPT = resolve(REPO_ROOT, "tests/_diet/audit.mjs");
const ARCH_DIR = resolve(REPO_ROOT, "tests/architecture");
const ARCH_PREFIX = "tests/architecture/";

function listArchitectureTestFiles() {
  return readdirSync(ARCH_DIR)
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => `${ARCH_PREFIX}${name}`)
    .sort();
}

describe("tests/_diet/audit.mjs — OUT_OF_SCOPE contract", () => {
  let report;
  let archFiles;
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kj-diet-audit-"));
    const outPath = join(tmpDir, "audit.json");
    execFileSync("node", [AUDIT_SCRIPT, "--out", outPath], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    report = JSON.parse(readFileSync(outPath, "utf8"));
    archFiles = listArchitectureTestFiles();
    expect(archFiles.length).toBeGreaterThan(0);
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits an outOfScope[] array containing every tests/architecture/* file", () => {
    expect(Array.isArray(report.outOfScope)).toBe(true);
    const reportedPaths = report.outOfScope.map((entry) => entry.path).sort();
    for (const archPath of archFiles) {
      expect(reportedPaths).toContain(archPath);
    }
  });

  it('every tests/architecture/* entry has classification "OUT_OF_SCOPE"', () => {
    const archEntries = report.outOfScope.filter((entry) =>
      entry.path.startsWith(ARCH_PREFIX)
    );
    expect(archEntries.length).toBe(archFiles.length);
    for (const entry of archEntries) {
      expect(entry.classification).toBe("OUT_OF_SCOPE");
    }
  });

  it("no architecture file leaks into the candidate files[] list", () => {
    const candidatePaths = report.files.map((f) => f.path);
    for (const archPath of archFiles) {
      expect(candidatePaths).not.toContain(archPath);
    }
    for (const candidate of candidatePaths) {
      expect(candidate.startsWith(ARCH_PREFIX)).toBe(false);
    }
  });

  it("totals.candidateCount excludes architecture files", () => {
    expect(report.totals.candidateCount).toBe(report.files.length);
    expect(report.totals.outOfScopeCount).toBe(report.outOfScope.length);
    expect(report.totals.outOfScopeCount).toBeGreaterThanOrEqual(archFiles.length);
  });
});
