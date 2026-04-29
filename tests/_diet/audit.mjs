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
 * @returns {{ out: string, mode: "audit" | "reportPins" | "annotate" | "checkCoverage", baseline: string | null, area: string | null }}
 */
function parseArgs(argv) {
  let out = DEFAULT_OUT;
  /** @type {"audit" | "reportPins" | "annotate" | "checkCoverage"} */
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
 * Verify the per-area diet guardrails after a pass. Exits 0 on green, 1 on
 * any guardrail breach. Three guardrails are enforced:
 *   1. total LOC of `tests/<area>/` is strictly below
 *      `perArea.<area>.locBefore` from the baseline.
 *   2. every surviving `.test.js` in the area is ≤ 300 LOC.
 *   3. every regression-pin `it/test/describe` block in the area still
 *      carries a `// regression-for:` annotation on the previous line.
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
  const areaPrefix = `tests/${area}/`;
  const areaRoot = join(REPO_ROOT, "tests", area);
  if (!statSync(areaRoot).isDirectory()) {
    process.stderr.write(`area directory not found: ${areaRoot}\n`);
    process.exit(1);
  }
  const files = walkTestFiles(areaRoot).sort();
  let locTotal = 0;
  /** @type {Array<{ rel: string, loc: number }>} */
  const oversized = [];
  /** @type {Array<{ rel: string, line: number, description: string }>} */
  const unannotatedPins = [];
  for (const abs of files) {
    const rel = toPosixRelPath(abs);
    if (!rel.startsWith(areaPrefix)) continue;
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

function main() {
  const { out, mode, baseline, area } = parseArgs(process.argv.slice(2));
  if (!statSync(TESTS_ROOT).isDirectory()) {
    throw new Error(`tests root not found: ${TESTS_ROOT}`);
  }
  if (mode === "reportPins") return runReportPins();
  if (mode === "annotate") return runAnnotate();
  if (mode === "checkCoverage") return runCheckCoverage(baseline, area);
  return runDefaultAudit(out);
}

main();
