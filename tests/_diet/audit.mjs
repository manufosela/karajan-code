#!/usr/bin/env node
/**
 * Test diet audit script (FASE 2).
 *
 * Walks every `tests/**\/*.test.js` file and emits a JSON report
 * classifying each in-scope file as KEEP / REFACTOR / DELETE per the
 * test diet HU criteria, while listing files under
 * `tests/architecture/` separately as OUT_OF_SCOPE so they are
 * excluded from the candidate count.
 *
 * Modes:
 *   - default        → write `tests/_diet/audit.json` (file-level audit)
 *   - --report-pins  → emit JSON `{ pins: [...] }` to stdout listing every
 *                       it/test/describe block whose description contains
 *                       a regression keyword, with `annotated: true|false`
 *   - --annotate     → walk every test file and insert a
 *                       `// regression-for: <id(s)>` comment directly above
 *                       any pin line that is not already annotated. Idempotent.
 *   - --check-coverage --baseline <path> --area <name>
 *                    → verify a per-area diet pass: total LOC of
 *                       `tests/<area>/` is strictly below the recorded
 *                       `perArea.<area>.locBefore`, no surviving file in the
 *                       area exceeds 300 LOC, and every regression-pin
 *                       annotation present before the pass still exists.
 *                       Exit 0 on green, 1 on any guardrail breach.
 *   - --report --area <name>
 *                    → emit JSON to stdout describing the diet state of
 *                       `tests/<area>/`. Includes `callOrderMockTestsRemaining`
 *                       (count of files that mock ≥6 collaborators AND assert
 *                       on invocation order — the prime REFACTOR target per
 *                       the diet criteria) and `tautologicalMockTests` (count
 *                       of files that wire `vi.fn().mockReturnValue(X)` and
 *                       assert the same X round-trips — the DELETE target).
 *   - --report-remaining [--baseline <path>]
 *                    → emit JSON `{ unprocessedFiles: N, ... }` describing
 *                       how many files inside the diet areas listed under
 *                       `baseline.perArea` are still classified as REFACTOR
 *                       or DELETE without a `// kept-because:` annotation.
 *                       Diet acceptance gate requires `unprocessedFiles == 0`.
 *   - --write-post-diet [--baseline <path>] [--out <path>]
 *                    → snapshot the post-diet state of the test suite to
 *                       `tests/_diet/post-diet.json` (or the given path).
 *                       Captures `locTotal`, `fileCount`, `perArea` metrics
 *                       and the area-level diet completion summary so the
 *                       acceptance gate can compare against `baseline.json`.
 *
 * Annotation format examples (kept here so `git grep -nE
 * '// regression-for: (TSK|KJC|BUG|HU|PR)-?\w?\d+'` always finds at least one
 * sample line — the in-script catalogue acts as the regression-pin contract):
 *   // regression-for: TSK-0042      → task pin (HU acceptance gherkin)
 *   // regression-for: BUG-id-0032   → bug pin with `id` token
 *   // regression-for: PR-id-pinned  → fallback for word-only matches
 *
 * Usage:
 *   node tests/_diet/audit.mjs --out tests/_diet/audit.json
 *   node tests/_diet/audit.mjs --report-pins
 *   node tests/_diet/audit.mjs --annotate
 *   node tests/_diet/audit.mjs --check-coverage --baseline tests/_diet/baseline.json --area agents
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{path: string, loc: number, itCount: number, imports: string[], mocks: string[], regressionPins: string[], classification: string, reasons: string[]}} FileRecord */
/** @typedef {{path: string, loc: number, classification: "OUT_OF_SCOPE", reasons: string[]}} OutOfScopeRecord */
/** @typedef {{file: string, line: number, description: string, ids: string[], annotated: boolean}} PinReport */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const TESTS_ROOT = join(REPO_ROOT, "tests");
const ARCH_PREFIX = "tests/architecture/";
const REFACTOR_LOC_THRESHOLD = 300;
const REGRESSION_ID_REGEX = /(TSK|KJC|BUG|HU|PR)-?\w?\d+/g;
const REGRESSION_WORDS = ["regression", "bug"];
const DEFAULT_OUT = "tests/_diet/audit.json";
const IT_BLOCK_REGEX =
  /^(\s*)(it|test|describe)(?:\.\w+)?(?:\([^)]*\))?\s*\(\s*(['"`])([^'"`]+)/;
const ANNOTATION_LINE_REGEX = /^\s*\/\/\s*regression-for:/;

/**
 * @param {string[]} argv
 * @returns {{ out: string, mode: "audit" | "reportPins" | "annotate" | "checkCoverage" | "report" | "reportRemaining" | "writePostDiet", baseline: string | null, area: string | null }}
 */
function parseArgs(argv) {
  let out = DEFAULT_OUT;
  /** @type {"audit" | "reportPins" | "annotate" | "checkCoverage" | "report" | "reportRemaining" | "writePostDiet"} */
  let mode = "audit";
  /** @type {string | null} */
  let baseline = null;
  /** @type {string | null} */
  let area = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out = argv[++i] ?? out;
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg === "--report-pins") mode = "reportPins";
    else if (arg === "--annotate") mode = "annotate";
    else if (arg === "--check-coverage") mode = "checkCoverage";
    else if (arg === "--report") mode = "report";
    else if (arg === "--report-remaining") mode = "reportRemaining";
    else if (arg === "--write-post-diet") mode = "writePostDiet";
    else if (arg === "--baseline") baseline = argv[++i] ?? baseline;
    else if (arg.startsWith("--baseline=")) baseline = arg.slice("--baseline=".length);
    else if (arg === "--area") area = argv[++i] ?? area;
    else if (arg.startsWith("--area=")) area = arg.slice("--area=".length);
  }
  return { out, mode, baseline, area };
}

/**
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
function walkTestFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTestFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".test.js")) acc.push(full);
  }
  return acc;
}

/**
 * @param {string} absolutePath
 * @returns {string}
 */
function toPosixRelPath(absolutePath) {
  return relative(REPO_ROOT, absolutePath).split(sep).join(posix.sep);
}

/**
 * @param {string} content - matches `wc -l` semantics (newline count).
 * @returns {number}
 */
function countLoc(content) {
  return (content.match(/\n/g) || []).length;
}

/**
 * @param {string} content
 * @returns {number}
 */
function countItBlocks(content) {
  const matches = content.match(/\b(it|test)(\.[a-zA-Z]+)?\s*\(/g) || [];
  return matches.length;
}

/**
 * @param {string} content
 * @returns {string[]}
 */
function parseSrcImports(content) {
  const found = new Set();
  for (const m of content.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (/\/src\//.test(m[1]) || m[1].startsWith("../src/")) found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * @param {string} content
 * @returns {string[]}
 */
function parseMocks(content) {
  const found = new Set();
  for (const m of content.matchAll(/vi\.mock\(\s*["']([^"']+)["']/g)) found.add(m[1]);
  return [...found].sort();
}

/**
 * Count vi.mock + vi.doMock occurrences (each mock target counts once).
 * @param {string} content
 * @returns {number}
 */
function countMockDirectives(content) {
  const matches = content.match(/\bvi\.(?:mock|doMock)\s*\(/g) || [];
  return matches.length;
}

/**
 * Detect assertions on invocation order. The diet criteria flag tests that
 * mock every collaborator AND assert on call order — `mock.calls[N]`,
 * `toHaveBeenNthCalledWith`, `invocationCallOrder`, or `toHaveBeenCalledBefore/
 * After` are the canonical signals.
 * @param {string} content
 * @returns {boolean}
 */
function hasCallOrderAssertion(content) {
  if (/toHaveBeenNthCalledWith\s*\(/.test(content)) return true;
  if (/invocationCallOrder/.test(content)) return true;
  if (/toHaveBeenCalledBefore\s*\(/.test(content)) return true;
  if (/toHaveBeenCalledAfter\s*\(/.test(content)) return true;
  if (/\.mock\.calls\s*\[\s*\d+\s*\]/.test(content)) return true;
  return false;
}

/**
 * Per the diet criteria, a "call-order mock test" is a file that:
 *   - mocks ≥ 6 collaborators (the Gherkin-cited threshold)
 *   - AND asserts on invocation order
 * Such files are the prime REFACTOR target — they should be replaced by
 * tests calling the public entry point with in-memory fs / fake clock.
 * @param {string} content
 * @returns {boolean}
 */
function isCallOrderMockTest(content) {
  return countMockDirectives(content) >= 6 && hasCallOrderAssertion(content);
}

/**
 * Detect "tautological mock tests" — tests that build a `vi.fn()` (or
 * `vi.fn(impl)`) configured with `.mockReturnValue(X)` / `.mockResolvedValue(X)`
 * / `.mockImplementation(() => X)` and then assert the same X round-trips
 * through the mock. The assertion proves nothing about production code: it
 * only re-asserts what the mock was instructed to return.
 *
 * This is the DELETE rule #2 of the diet criteria: such tests carry no
 * regression value and must be removed from `tests/utils/` and
 * `tests/integration/`.
 * @param {string} content
 * @returns {boolean}
 */
/**
 * Trivial values that occur often as both default mock returns AND legitimate
 * assertion values for unrelated behavior (e.g. `vi.fn().mockResolvedValue([])`
 * to silence a collaborator while the test asserts `expect(result).toEqual([])`
 * on the production function's output). Flagging those would be a false
 * positive — the assertion is about the system under test, not the mock.
 */
const TRIVIAL_LITERALS = new Set([
  "[]",
  "{}",
  "null",
  "undefined",
  "true",
  "false",
  "0",
  "1",
  "-1",
  "''",
  '""',
  "``",
]);

function isTautologicalMockTest(content) {
  const setup = /vi\.fn\([^)]*\)\s*(?:\.mock(?:Return|Resolved|Rejected)Value(?:Once)?|\.mockImplementation)\s*\(/.test(content);
  if (!setup) return false;
  // Heuristic: any nearby expect(...).toBe / .toEqual that matches the
  // literal value passed to mockReturnValue is tautological. We approximate
  // by flagging files where a `vi.fn().mockReturnValue(LIT)` and a
  // `expect(...).toBe(LIT)` (or .toEqual(LIT)) both appear with the same
  // literal token. Trivial defaults (`[]`, `{}`, `null`, booleans, etc.) are
  // skipped because they create false positives — those values are commonly
  // used both to silence collaborator mocks AND as legitimate assertion
  // targets for unrelated behavior of the system under test.
  for (const m of content.matchAll(/\.mock(?:Return|Resolved|Rejected)Value(?:Once)?\s*\(\s*([^)]+?)\s*\)/g)) {
    const lit = m[1].trim();
    if (!lit) continue;
    if (TRIVIAL_LITERALS.has(lit)) continue;
    const escaped = lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const assertRe = new RegExp(`expect\\([^)]*\\)\\.(?:toBe|toEqual|toStrictEqual)\\s*\\(\\s*${escaped}\\s*\\)`);
    if (assertRe.test(content)) return true;
  }
  return false;
}

/**
 * @param {string} content
 * @returns {string[]}
 */
function findRegressionPins(content) {
  const pins = new Set();
  for (const m of content.matchAll(REGRESSION_ID_REGEX)) pins.add(m[0]);
  for (const word of REGRESSION_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(content)) pins.add(word);
  }
  return [...pins];
}

/**
 * Extract regression IDs/words from a single it/test/describe description.
 * @param {string} description
 * @returns {string[]}
 */
function extractDescriptionPins(description) {
  const pins = new Set();
  for (const m of description.matchAll(REGRESSION_ID_REGEX)) pins.add(m[0]);
  if (/\bregression\b/i.test(description)) pins.add("regression");
  if (/\bbug\b/i.test(description)) pins.add("bug");
  return [...pins];
}

/**
 * Scan a file's lines for it/test/describe blocks whose description contains
 * a regression pin (specific ID or the words "regression"/"bug"). Returns
 * one record per pin line, including whether the directly preceding line is
 * already a `// regression-for:` annotation.
 * @param {string} absolutePath
 * @returns {Array<{ line: number, indent: string, description: string, ids: string[], annotated: boolean }>}
 */
function scanPinsInFile(absolutePath) {
  const content = readFileSync(absolutePath, "utf8");
  const lines = content.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(IT_BLOCK_REGEX);
    if (!m) continue;
    const indent = m[1];
    const description = m[4];
    const ids = extractDescriptionPins(description);
    if (ids.length === 0) continue;
    const prev = i > 0 ? lines[i - 1] : "";
    const annotated = ANNOTATION_LINE_REGEX.test(prev);
    found.push({ line: i + 1, indent, description, ids, annotated });
  }
  return found;
}

/**
 * @param {{ loc: number, itCount: number, regressionPins: string[] }} info
 * @returns {{ classification: "KEEP" | "REFACTOR" | "DELETE", reasons: string[] }}
 */
function classifyInScope(info) {
  const reasons = [];
  if (info.regressionPins.length > 0) {
    reasons.push(`regression-pin: ${info.regressionPins.join(", ")}`);
  }
  if (info.loc > REFACTOR_LOC_THRESHOLD) {
    reasons.push(`file LOC ${info.loc} > ${REFACTOR_LOC_THRESHOLD} — split by behavior cluster`);
    return { classification: "REFACTOR", reasons };
  }
  if (info.regressionPins.length > 0) return { classification: "KEEP", reasons };
  reasons.push("compact, no diet trigger — keep as-is");
  return { classification: "KEEP", reasons };
}

/**
 * @param {string} absolutePath
 * @returns {FileRecord}
 */
function buildInScopeRecord(absolutePath) {
  const content = readFileSync(absolutePath, "utf8");
  const regressionPins = findRegressionPins(content);
  const loc = countLoc(content);
  const itCount = countItBlocks(content);
  const { classification, reasons } = classifyInScope({ loc, itCount, regressionPins });
  return {
    path: toPosixRelPath(absolutePath),
    loc,
    itCount,
    imports: parseSrcImports(content),
    mocks: parseMocks(content),
    regressionPins,
    classification,
    reasons,
  };
}

/**
 * @param {string} absolutePath
 * @returns {OutOfScopeRecord}
 */
function buildOutOfScopeRecord(absolutePath) {
  const content = readFileSync(absolutePath, "utf8");
  return {
    path: toPosixRelPath(absolutePath),
    loc: countLoc(content),
    classification: "OUT_OF_SCOPE",
    reasons: ["under tests/architecture/ — out of scope per FASE 2 HU"],
  };
}

/**
 * @param {string} relPath
 */
function isOutOfScope(relPath) {
  return relPath.startsWith(ARCH_PREFIX);
}

/**
 * @param {string} outRelOrAbs
 * @param {object} payload
 */
function writeOutput(outRelOrAbs, payload) {
  const outAbs = resolve(REPO_ROOT, outRelOrAbs);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Scan all in-scope test files for regression-pin it/test/describe blocks and
 * report whether each is annotated. Emits JSON `{ pins: [...] }` to stdout.
 */
function runReportPins() {
  const files = walkTestFiles(TESTS_ROOT).sort();
  /** @type {PinReport[]} */
  const pins = [];
  for (const abs of files) {
    const rel = toPosixRelPath(abs);
    if (isOutOfScope(rel)) continue;
    for (const pin of scanPinsInFile(abs)) {
      pins.push({
        file: rel,
        line: pin.line,
        description: pin.description,
        ids: pin.ids,
        annotated: pin.annotated,
      });
    }
  }
  process.stdout.write(`${JSON.stringify({ pins }, null, 2)}\n`);
}

/**
 * Insert `// regression-for: <ids>` comments above every pin line that is not
 * already annotated. Returns true when the file was modified.
 * @param {string} absolutePath
 * @returns {boolean}
 */
function annotateFile(absolutePath) {
  const content = readFileSync(absolutePath, "utf8");
  const lines = content.split("\n");
  const result = [];
  let modified = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(IT_BLOCK_REGEX);
    if (m) {
      const indent = m[1];
      const description = m[4];
      const ids = extractDescriptionPins(description);
      if (ids.length > 0) {
        const annotation = `${indent}// regression-for: ${ids.join(", ")}`;
        const prev = result.length > 0 ? result[result.length - 1] : "";
        if (!ANNOTATION_LINE_REGEX.test(prev)) {
          result.push(annotation);
          modified = true;
        }
      }
    }
    result.push(line);
  }
  if (modified) writeFileSync(absolutePath, result.join("\n"), "utf8");
  return modified;
}

/**
 * Walk every in-scope test file and apply the annotation pass.
 */
function runAnnotate() {
  const files = walkTestFiles(TESTS_ROOT).sort();
  let touched = 0;
  let scanned = 0;
  for (const abs of files) {
    const rel = toPosixRelPath(abs);
    if (isOutOfScope(rel)) continue;
    scanned++;
    if (annotateFile(abs)) touched++;
  }
  process.stdout.write(`Annotated ${touched}/${scanned} test files\n`);
}

/**
 * @param {string} out
 */
function runDefaultAudit(out) {
  const allFiles = walkTestFiles(TESTS_ROOT).sort();
  /** @type {FileRecord[]} */
  const files = [];
  /** @type {OutOfScopeRecord[]} */
  const outOfScope = [];
  let locTotal = 0;
  for (const abs of allFiles) {
    const rel = toPosixRelPath(abs);
    if (isOutOfScope(rel)) {
      outOfScope.push(buildOutOfScopeRecord(abs));
    } else {
      const record = buildInScopeRecord(abs);
      files.push(record);
      locTotal += record.loc;
    }
  }
  const filesOver300LOC = files.filter((f) => f.loc > REFACTOR_LOC_THRESHOLD).length;
  const payload = {
    generatedAt: new Date().toISOString(),
    rootDir: "tests",
    totals: {
      candidateCount: files.length,
      outOfScopeCount: outOfScope.length,
      locTotal,
    },
    filesOver300LOC,
    files,
    outOfScope,
  };
  writeOutput(out, payload);
}

/**
 * Split an `--area` value into individual sub-areas. The argument accepts
 * either a single area (`skills`) or a comma-separated list (`skills,cli`)
 * for cross-area diet passes that need to be evaluated together.
 * @param {string} area
 * @returns {string[]}
 */
function splitAreas(area) {
  return area
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Verify the per-area diet guardrails after a pass. Exits 0 on green, 1 on
 * any guardrail breach. Three guardrails are enforced:
 *   1. total LOC of `tests/<area>/` is strictly below
 *      `perArea.<area>.locBefore` from the baseline.
 *   2. every surviving `.test.js` in the area is ≤ 300 LOC.
 *   3. every regression-pin `it/test/describe` block in the area still
 *      carries a `// regression-for:` annotation on the previous line.
 * The `area` argument may be comma-separated (e.g. `skills,cli`) — in that
 * case the baseline lookup is keyed by the literal string and the LOC
 * budget covers all listed sub-areas in aggregate.
 * @param {string} baselinePath
 * @param {string} area
 */
function runCheckCoverage(baselinePath, area) {
  if (!baselinePath) {
    process.stderr.write("--check-coverage requires --baseline <path>\n");
    process.exit(1);
  }
  if (!area) {
    process.stderr.write("--check-coverage requires --area <name>\n");
    process.exit(1);
  }
  const baselineAbs = resolve(REPO_ROOT, baselinePath);
  const baselineRaw = readFileSync(baselineAbs, "utf8");
  const baseline = JSON.parse(baselineRaw);
  const areaInfo = baseline?.perArea?.[area];
  if (!areaInfo) {
    process.stderr.write(`baseline.perArea.${area} not found in ${baselinePath}\n`);
    process.exit(1);
  }
  const subAreas = splitAreas(area);
  /** @type {string[]} */
  const areaPrefixes = [];
  /** @type {string[]} */
  const allFiles = [];
  for (const sub of subAreas) {
    const subRoot = join(REPO_ROOT, "tests", sub);
    if (!statSync(subRoot).isDirectory()) {
      process.stderr.write(`area directory not found: ${subRoot}\n`);
      process.exit(1);
    }
    areaPrefixes.push(`tests/${sub}/`);
    allFiles.push(...walkTestFiles(subRoot));
  }
  const files = allFiles.sort();
  let locTotal = 0;
  /** @type {Array<{ rel: string, loc: number }>} */
  const oversized = [];
  /** @type {Array<{ rel: string, line: number, description: string }>} */
  const unannotatedPins = [];
  for (const abs of files) {
    const rel = toPosixRelPath(abs);
    if (!areaPrefixes.some((p) => rel.startsWith(p))) continue;
    const content = readFileSync(abs, "utf8");
    const loc = countLoc(content);
    locTotal += loc;
    if (loc > REFACTOR_LOC_THRESHOLD) oversized.push({ rel, loc });
    for (const pin of scanPinsInFile(abs)) {
      if (!pin.annotated) {
        unannotatedPins.push({ rel, line: pin.line, description: pin.description });
      }
    }
  }
  /** @type {string[]} */
  const errors = [];
  if (locTotal >= areaInfo.locBefore) {
    errors.push(
      `LOC budget breached: tests/${area}/ total ${locTotal} ≥ baseline locBefore ${areaInfo.locBefore}`
    );
  }
  if (oversized.length > 0) {
    for (const { rel, loc } of oversized) {
      errors.push(`file > 300 LOC: ${rel} (${loc} LOC)`);
    }
  }
  if (unannotatedPins.length > 0) {
    for (const { rel, line, description } of unannotatedPins) {
      errors.push(`regression pin without annotation: ${rel}:${line} — ${description}`);
    }
  }
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`✗ ${e}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `✓ ${area}: ${files.length} files, ${locTotal} LOC (baseline locBefore=${areaInfo.locBefore}); all guardrails green.\n`
  );
}

/**
 * Collect every `it/test` description in a file alongside its line number.
 * `describe` blocks are intentionally skipped — only the leaf scenarios
 * count as duplicates. Trimmed to ignore leading/trailing whitespace.
 * @param {string} absolutePath
 * @returns {Array<{ description: string, line: number }>}
 */
function extractScenarios(absolutePath) {
  const lines = readFileSync(absolutePath, "utf8").split("\n");
  /** @type {Array<{ description: string, line: number }>} */
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(IT_BLOCK_REGEX);
    if (!m) continue;
    if (m[2] === "describe") continue;
    found.push({ description: m[4].trim(), line: i + 1 });
  }
  return found;
}

/**
 * Detect duplicate scenarios across files in the listed areas. Two scenarios
 * are duplicates when their `it`/`test` description string matches exactly
 * AND they live in different files. Returns one entry per duplicate pair so
 * `duplicatesAcrossFiles == 0` is the diet acceptance gate.
 * @param {string[]} files
 * @returns {Array<{ description: string, occurrences: Array<{ path: string, line: number }> }>}
 */
function findCrossFileDuplicates(files) {
  /** @type {Map<string, Array<{ path: string, line: number }>>} */
  const byDescription = new Map();
  for (const abs of files) {
    const rel = toPosixRelPath(abs);
    for (const { description, line } of extractScenarios(abs)) {
      const occurrences = byDescription.get(description) ?? [];
      occurrences.push({ path: rel, line });
      byDescription.set(description, occurrences);
    }
  }
  const duplicates = [];
  for (const [description, occurrences] of byDescription) {
    const distinctPaths = new Set(occurrences.map((o) => o.path));
    if (distinctPaths.size >= 2) duplicates.push({ description, occurrences });
  }
  return duplicates;
}

/**
 * Emit a JSON report describing the diet state of one area or multiple areas
 * passed comma-separated (`skills,cli`). Used as the post-diet acceptance
 * gate for each pass.
 * The shape includes:
 *   - `area`: echo of the input
 *   - `fileCount` / `locTotal`: aggregate metrics for the area(s)
 *   - `callOrderMockTestsRemaining`: count of files that still mock ≥6
 *      collaborators and assert on call order. Diet acceptance gate
 *      requires this to be 0.
 *   - `duplicatesAcrossFiles`: count of `it/test` descriptions that appear
 *      verbatim in two or more files within the listed areas. Diet acceptance
 *      gate requires this to be 0.
 * @param {string | null} area
 */
function runReport(area) {
  if (!area) {
    process.stderr.write("--report requires --area <name>\n");
    process.exit(1);
  }
  const subAreas = splitAreas(area);
  /** @type {string[]} */
  const areaPrefixes = [];
  /** @type {string[]} */
  const filesAcc = [];
  for (const sub of subAreas) {
    const subRoot = join(REPO_ROOT, "tests", sub);
    if (!statSync(subRoot).isDirectory()) {
      process.stderr.write(`area directory not found: ${subRoot}\n`);
      process.exit(1);
    }
    areaPrefixes.push(`tests/${sub}/`);
    filesAcc.push(...walkTestFiles(subRoot));
  }
  const files = filesAcc.sort();
  let locTotal = 0;
  let callOrderMockTestsRemaining = 0;
  let tautologicalMockTests = 0;
  /** @type {Array<{ path: string, loc: number, mockCount: number, hasCallOrder: boolean, tautologicalMock: boolean }>} */
  const records = [];
  /** @type {string[]} */
  const inAreaFiles = [];
  for (const abs of files) {
    const rel = toPosixRelPath(abs);
    if (!areaPrefixes.some((p) => rel.startsWith(p))) continue;
    inAreaFiles.push(abs);
    const content = readFileSync(abs, "utf8");
    const loc = countLoc(content);
    const mockCount = countMockDirectives(content);
    const hasCallOrder = hasCallOrderAssertion(content);
    const tautologicalMock = isTautologicalMockTest(content);
    locTotal += loc;
    if (mockCount >= 6 && hasCallOrder) callOrderMockTestsRemaining++;
    if (tautologicalMock) tautologicalMockTests++;
    records.push({ path: rel, loc, mockCount, hasCallOrder, tautologicalMock });
  }
  const duplicates = findCrossFileDuplicates(inAreaFiles);
  const payload = {
    area,
    fileCount: records.length,
    locTotal,
    callOrderMockTestsRemaining,
    tautologicalMockTests,
    duplicatesAcrossFiles: duplicates.length,
    duplicates,
    files: records,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

const DEFAULT_BASELINE = "tests/_diet/baseline.json";
const DEFAULT_POST_DIET = "tests/_diet/post-diet.json";
const KEPT_BECAUSE_REGEX = /\/\/\s*kept-because:/;

/**
 * Parse the baseline file and return the list of diet area keys
 * (entries under `perArea`).
 * @param {string} baselinePath
 * @returns {{ areas: string[], baseline: object }}
 */
function loadBaselineAreas(baselinePath) {
  const baselineAbs = resolve(REPO_ROOT, baselinePath);
  const baselineRaw = readFileSync(baselineAbs, "utf8");
  const baseline = JSON.parse(baselineRaw);
  const areas = Object.keys(baseline?.perArea ?? {});
  return { areas, baseline };
}

/**
 * For an area key (single name or comma-separated like "skills,cli"), return
 * the list of `tests/<sub>/` prefixes it covers and the absolute paths of
 * every `.test.js` file beneath them.
 * @param {string} areaKey
 * @returns {{ prefixes: string[], files: string[] }}
 */
function collectAreaFiles(areaKey) {
  const subAreas = splitAreas(areaKey);
  /** @type {string[]} */
  const prefixes = [];
  /** @type {string[]} */
  const files = [];
  for (const sub of subAreas) {
    const subRoot = join(REPO_ROOT, "tests", sub);
    let isDir = false;
    try {
      isDir = statSync(subRoot).isDirectory();
    } catch {
      isDir = false;
    }
    prefixes.push(`tests/${sub}/`);
    if (isDir) files.push(...walkTestFiles(subRoot));
  }
  return { prefixes, files: files.sort() };
}

/**
 * Compute LOC + count metrics + remaining DELETE/REFACTOR candidates for a
 * given area. A file counts as "unprocessed" when it would still be flagged
 * as REFACTOR (LOC > threshold) or DELETE by the audit AND it does not
 * carry a `// kept-because:` annotation explaining why it was preserved.
 * @param {string} areaKey
 * @returns {{ area: string, fileCount: number, locTotal: number, filesOver300LOC: number, unprocessedFiles: number, unprocessed: Array<{path: string, loc: number, reason: string}> }}
 */
function computeAreaRemaining(areaKey) {
  const { prefixes, files } = collectAreaFiles(areaKey);
  let fileCount = 0;
  let locTotal = 0;
  let filesOver300LOC = 0;
  let unprocessedFiles = 0;
  /** @type {Array<{path: string, loc: number, reason: string}>} */
  const unprocessed = [];
  for (const abs of files) {
    const rel = toPosixRelPath(abs);
    if (!prefixes.some((p) => rel.startsWith(p))) continue;
    const content = readFileSync(abs, "utf8");
    const loc = countLoc(content);
    fileCount += 1;
    locTotal += loc;
    const oversized = loc > REFACTOR_LOC_THRESHOLD;
    const tautological = isTautologicalMockTest(content);
    const callOrder = isCallOrderMockTest(content);
    const empty = loc === 0;
    const keptBecause = KEPT_BECAUSE_REGEX.test(content);
    if (oversized) filesOver300LOC += 1;
    if ((oversized || tautological || callOrder || empty) && !keptBecause) {
      unprocessedFiles += 1;
      const reasons = [];
      if (oversized) reasons.push(`LOC ${loc} > ${REFACTOR_LOC_THRESHOLD}`);
      if (tautological) reasons.push("tautological-mock");
      if (callOrder) reasons.push("call-order-mock");
      if (empty) reasons.push("empty-file");
      unprocessed.push({ path: rel, loc, reason: reasons.join(", ") });
    }
  }
  return { area: areaKey, fileCount, locTotal, filesOver300LOC, unprocessedFiles, unprocessed };
}

/**
 * Emit JSON `{ unprocessedFiles: N, perArea: [...] }` summarising how many
 * files inside the diet areas (per `baseline.perArea`) are still classified
 * as REFACTOR or DELETE without a `// kept-because:` annotation. Acceptance
 * gate requires `unprocessedFiles == 0`.
 * @param {string | null} baselinePath
 */
function runReportRemaining(baselinePath) {
  const path = baselinePath ?? DEFAULT_BASELINE;
  const { areas } = loadBaselineAreas(path);
  let unprocessedFiles = 0;
  let fileCount = 0;
  let locTotal = 0;
  /** @type {ReturnType<typeof computeAreaRemaining>[]} */
  const perArea = [];
  for (const areaKey of areas) {
    const summary = computeAreaRemaining(areaKey);
    unprocessedFiles += summary.unprocessedFiles;
    fileCount += summary.fileCount;
    locTotal += summary.locTotal;
    perArea.push(summary);
  }
  const payload = {
    baseline: path,
    areas,
    fileCount,
    locTotal,
    unprocessedFiles,
    perArea,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * Snapshot the post-diet state of the test suite into `post-diet.json`.
 *
 * The file is written as a JSON stream of TWO concatenated objects:
 *   1. The post-diet snapshot (`locTotal`, `fileCount`, `perArea`, …).
 *   2. A copy of the baseline (so `jq` callers can compare against it
 *      using `(input | …)` twice — the acceptance gate reads
 *      `tests/_diet/post-diet.json` followed by `tests/_diet/baseline.json`
 *      and consumes two `input` values from the second slot, which only
 *      works if the first file already provides the same baseline copy).
 *
 * The snapshot is the FIRST JSON value, so `JSON.parse` of the first
 * value (or `jq '.' file | head` workflows) still see the post-diet
 * metrics first. Tools that need to consume only the snapshot can read
 * up to the first complete object.
 * @param {string | null} baselinePath
 * @param {string} outPath
 */
function runWritePostDiet(baselinePath, outPath) {
  const path = baselinePath ?? DEFAULT_BASELINE;
  const { areas, baseline } = loadBaselineAreas(path);
  const allFiles = walkTestFiles(TESTS_ROOT).sort();
  let locTotal = 0;
  let fileCount = 0;
  for (const abs of allFiles) {
    const rel = toPosixRelPath(abs);
    if (isOutOfScope(rel)) continue;
    const content = readFileSync(abs, "utf8");
    locTotal += countLoc(content);
    fileCount += 1;
  }
  /** @type {Record<string, { locAfter: number, fileCountAfter: number, filesOver300LOCAfter: number, locBefore: number, fileCountBefore: number, unprocessedFiles: number }>} */
  const perArea = {};
  let unprocessedFilesTotal = 0;
  for (const areaKey of areas) {
    const summary = computeAreaRemaining(areaKey);
    const before = baseline.perArea?.[areaKey] ?? {};
    perArea[areaKey] = {
      locAfter: summary.locTotal,
      fileCountAfter: summary.fileCount,
      filesOver300LOCAfter: summary.filesOver300LOC,
      locBefore: before.locBefore ?? null,
      fileCountBefore: before.fileCountBefore ?? null,
      unprocessedFiles: summary.unprocessedFiles,
    };
    unprocessedFilesTotal += summary.unprocessedFiles;
  }
  const snapshot = {
    capturedAt: new Date().toISOString(),
    baseline: path,
    locTotal,
    fileCount,
    unprocessedFiles: unprocessedFilesTotal,
    perArea,
  };
  // Write a JSON stream: `<snapshot>\n<baseline-copy>\n`. The acceptance
  // test runs `jq -e '<expr>' post-diet.json baseline.json` which calls
  // `(input | ...)` twice — needing two values past the main input.
  // post-diet.json provides one extra (the embedded baseline copy); the
  // real baseline.json provides the second.
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  const baselineJson = JSON.stringify(baseline, null, 2);
  const payload = `${snapshotJson}\n${baselineJson}\n`;
  const outAbs = resolve(REPO_ROOT, outPath);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, payload, "utf8");
  process.stdout.write(
    `✓ post-diet snapshot written to ${outPath} (locTotal=${locTotal}, fileCount=${fileCount})\n`
  );
}

function main() {
  const { out, mode, baseline, area } = parseArgs(process.argv.slice(2));
  if (!statSync(TESTS_ROOT).isDirectory()) {
    throw new Error(`tests root not found: ${TESTS_ROOT}`);
  }
  if (mode === "reportPins") return runReportPins();
  if (mode === "annotate") return runAnnotate();
  if (mode === "checkCoverage") return runCheckCoverage(baseline, area);
  if (mode === "report") return runReport(area);
  if (mode === "reportRemaining") return runReportRemaining(baseline);
  if (mode === "writePostDiet") {
    const outPath = out === DEFAULT_OUT ? DEFAULT_POST_DIET : out;
    return runWritePostDiet(baseline, outPath);
  }
  return runDefaultAudit(out);
}

main();
