#!/usr/bin/env node
/**
 * Test Diet — baseline snapshot generator.
 *
 * Captures the *current* state of the unit test suite so subsequent diet
 * commits (HU plan-20260429094214-0srv_002 .. _008) can prove they did not
 * blow past the guardrails (wall-clock budget and branch-coverage drop).
 *
 * Output file: tests/_diet/baseline.json
 *
 * Schema:
 *   {
 *     capturedAt:        ISO-8601 timestamp,
 *     locTotal:          total wc -l across every tests/...test.js file,
 *     wallClockSec:      number,  // `time npm test` wall-clock
 *     branchCoveragePct: number,  // src/ branch coverage % from vitest --coverage
 *     fileCount:         number,  // files.length
 *     files:             [ { path, loc, architecture } ]
 *   }
 *
 * The script is intentionally *measurement-only*: it never edits source
 * or test files. Re-running it overwrites the snapshot — but the diet
 * compares against the committed copy, not the latest run.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const OUTPUT_PATH = resolve(REPO_ROOT, "tests/_diet/baseline.json");
const ARCH_PREFIX = "tests/architecture/";

/**
 * Enumerate every committed `tests/**\/*.test.js` file via `git ls-files`.
 * Using git rather than fs walk keeps the snapshot reproducible: untracked
 * scratch files in someone's worktree never leak into the baseline.
 *
 * @returns {string[]} repo-relative paths
 */
function listTestFiles() {
  const out = execFileSync(
    "git",
    ["ls-files", "tests"],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".test.js"));
}

/**
 * Count lines in a file. Uses readFileSync because the files are small and
 * spawning `wc -l` 300+ times is wasteful.
 *
 * @param {string} absPath
 * @returns {number}
 */
function countLines(absPath) {
  const content = readFileSync(absPath, "utf8");
  if (content.length === 0) return 0;
  // wc -l counts newlines; mimic that so the JSON matches `wc -l` output.
  let lines = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) lines += 1;
  }
  return lines;
}

/**
 * Run `npm test` once and report wall-clock seconds. The suite has a
 * pre-existing architecture-budget failure (tests/architecture/dynamic-imports);
 * its exit code is irrelevant for the wall-clock baseline.
 *
 * @returns {number} seconds, rounded to 2 decimals
 */
function measureWallClock() {
  const started = process.hrtime.bigint();
  spawnSync("npm", ["test", "--silent"], {
    cwd: REPO_ROOT,
    stdio: "ignore"
  });
  const elapsedNs = process.hrtime.bigint() - started;
  return Math.round(Number(elapsedNs) / 1e7) / 100;
}

/**
 * Run vitest with v8 coverage and parse the `text-summary` reporter output
 * for the `Branches` percentage of the src/ tree.
 *
 * The architecture-budget test fails before the coverage summary is emitted,
 * so we exclude that single file from this measurement run only. It scans
 * source files statically and does not exercise src/ runtime code, so its
 * absence does not move branch coverage in any meaningful way.
 *
 * @returns {number} branch coverage % (e.g. 17.23)
 */
function measureBranchCoverage() {
  const result = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reporter=text-summary",
      "--exclude=tests/architecture/dynamic-imports.test.js"
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  const out = `${result.stdout}\n${result.stderr}`;
  const match = out.match(/Branches\s*:\s*([\d.]+)%/);
  if (!match) {
    throw new Error(
      "Could not parse branch coverage from vitest output:\n" +
        out.slice(-2000)
    );
  }
  return Number(match[1]);
}

/**
 * Build the files[] array with metadata for every test file.
 *
 * @param {string[]} relativePaths
 * @returns {Array<{path: string, loc: number, architecture: boolean}>}
 */
function buildFileEntries(relativePaths) {
  return relativePaths
    .map((rel) => ({
      path: rel,
      loc: countLines(resolve(REPO_ROOT, rel)),
      architecture: rel.startsWith(ARCH_PREFIX)
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function main() {
  const relPaths = listTestFiles();
  const files = buildFileEntries(relPaths);
  const locTotal = files.reduce((sum, f) => sum + f.loc, 0);

  // Order matters: cheap measurements first, expensive ones last, so a
  // wedge in the slow ones is easy to bisect via Ctrl-C.
  const wallClockSec = measureWallClock();
  const branchCoveragePct = measureBranchCoverage();

  const baseline = {
    capturedAt: new Date().toISOString(),
    locTotal,
    wallClockSec,
    branchCoveragePct,
    fileCount: files.length,
    files
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Wrote ${relative(REPO_ROOT, OUTPUT_PATH)} — ` +
      `${baseline.fileCount} files, ${baseline.locTotal} LOC, ` +
      `${baseline.wallClockSec}s wall-clock, ` +
      `${baseline.branchCoveragePct}% branch coverage.\n`
  );
}

main();
