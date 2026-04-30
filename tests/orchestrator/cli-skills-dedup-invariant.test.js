/**
 * Diet-pass invariant: tests/cli/* and tests/skills/* must not duplicate
 * `kj run --task-file` exit-code assertions.
 *
 * Acceptance scenario (HU contract):
 *   Given two tests asserting the same `kj run --task-file` exit code,
 *         one in tests/skills and one in tests/cli
 *   When  the diet pass runs
 *   Then  only the more descriptive of the two survives, annotated with
 *         `// merged-from: <other-test-path>:<lineno>`
 *
 * Implementation strategy: scan both directories for `it()` / `it.each()`
 * blocks whose body references `kj run` AND `--task-file` AND an exit-code
 * assertion (`.toBe(<code>)`, `code === <n>`, `expect(...).code`...). For
 * every (cliBlock, skillsBlock) pair that asserts the SAME exit code, the
 * invariant requires the diet pass to have collapsed the pair into a
 * single survivor annotated with `// merged-from: <other>:<lineno>`.
 *
 * If neither layer asserts that contract today, the invariant is
 * vacuously satisfied — that is the *post-diet-pass* state, and the
 * regression-pin scans both dirs to catch a re-introduced duplicate.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const CLI_DIR = join(REPO_ROOT, "tests", "cli");
const SKILLS_DIR = join(REPO_ROOT, "tests", "skills");

/** @typedef {{file: string, line: number, snippet: string, exitCode: number | null, hasMergedFrom: boolean, mergedFromTarget: string | null}} ItBlock */

const IT_HEADER_REGEX = /\b(?:it|test)(?:\.each\([^)]*\))?\s*\(\s*['"`]/;
const TASK_FILE_REGEX = /--task-file\b|--task_file\b|"task[-_]?file"/;
const KJ_RUN_REGEX = /\bkj\s+run\b|"kj",\s*"run"|\["run",|kjRun\b/i;
const EXIT_CODE_REGEX =
  /(?:exitCode|\.code|\bstatus)\s*(?:===?|toBe\s*\(|toEqual\s*\(|toStrictEqual\s*\()\s*(\d+)|toBe\s*\(\s*(\d+)\s*\)\s*;?\s*\/\/\s*exit/i;
const MERGED_FROM_REGEX =
  /\/\/\s*merged-from:\s*([^\s,]+:\d+)/;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listTestFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTestFiles(full));
    } else if (name.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Find every `it()` block that asserts a `kj run --task-file` exit code.
 * The block body is approximated as the lines from the `it(` opener to
 * the first line whose indentation matches the opener (sufficient for
 * the kind of files we have here — a structured AST parse is overkill).
 *
 * @param {string} absPath
 * @returns {ItBlock[]}
 */
function extractTaskFileExitCodeBlocks(absPath) {
  const content = readFileSync(absPath, "utf8");
  const lines = content.split("\n");
  /** @type {ItBlock[]} */
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!IT_HEADER_REGEX.test(lines[i])) continue;
    const baseIndent = lines[i].match(/^\s*/)?.[0].length ?? 0;

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const trimmed = lines[j].trim();
      if (!trimmed) continue;
      const indent = lines[j].match(/^\s*/)?.[0].length ?? 0;
      if (indent <= baseIndent && (trimmed.startsWith("})") || trimmed.startsWith("});"))) {
        end = j;
        break;
      }
    }

    const blockLines = lines.slice(i, end + 1);
    const body = blockLines.join("\n");

    if (!KJ_RUN_REGEX.test(body)) continue;
    if (!TASK_FILE_REGEX.test(body)) continue;

    const exitMatch = body.match(EXIT_CODE_REGEX);
    if (!exitMatch) continue;
    const exitCode = Number(exitMatch[1] ?? exitMatch[2]);

    // Look up to 3 lines above the `it(` for a `// merged-from:` marker.
    /** @type {string | null} */
    let mergedFromTarget = null;
    for (let k = Math.max(0, i - 3); k < i; k += 1) {
      const m = lines[k].match(MERGED_FROM_REGEX);
      if (m) {
        mergedFromTarget = m[1];
        break;
      }
    }

    out.push({
      file: relative(REPO_ROOT, absPath),
      line: i + 1,
      snippet: blockLines[0].trim().slice(0, 120),
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      hasMergedFrom: mergedFromTarget !== null,
      mergedFromTarget,
    });
  }

  return out;
}

/** @param {string} dir */
function collectFromDir(dir) {
  /** @type {ItBlock[]} */
  const acc = [];
  for (const file of listTestFiles(dir)) {
    acc.push(...extractTaskFileExitCodeBlocks(file));
  }
  return acc;
}

describe("diet pass — tests/cli ↔ tests/skills must not duplicate `kj run --task-file` exit-code assertions", () => {
  it("for every shared exit code, at most one survivor remains and (if any merger occurred) it carries a `// merged-from:` annotation", () => {
    const cliBlocks = collectFromDir(CLI_DIR);
    const skillsBlocks = collectFromDir(SKILLS_DIR);

    /** @type {Array<{exitCode: number, cli: ItBlock, skills: ItBlock}>} */
    const offenders = [];

    for (const c of cliBlocks) {
      for (const s of skillsBlocks) {
        if (c.exitCode === null || s.exitCode === null) continue;
        if (c.exitCode !== s.exitCode) continue;
        // Both still here → diet pass missed the merge.
        // The contract: only one survives, and it carries an annotation.
        const annotatedCount = Number(c.hasMergedFrom) + Number(s.hasMergedFrom);
        if (annotatedCount === 0) {
          offenders.push({ exitCode: c.exitCode, cli: c, skills: s });
        }
      }
    }

    expect(
      offenders,
      `Found ${offenders.length} unannotated duplicate pair(s):\n` +
        offenders
          .map(
            (o) =>
              `  exit=${o.exitCode}\n    cli:    ${o.cli.file}:${o.cli.line}\n    skills: ${o.skills.file}:${o.skills.line}`,
          )
          .join("\n"),
    ).toEqual([]);
  });

  it("any survivor that does carry `// merged-from:` points at a real path:lineno (not a placeholder)", () => {
    const all = [...collectFromDir(CLI_DIR), ...collectFromDir(SKILLS_DIR)];
    const annotated = all.filter((b) => b.hasMergedFrom);

    /** @type {string[]} */
    const malformed = [];
    for (const b of annotated) {
      if (!b.mergedFromTarget) {
        malformed.push(`${b.file}:${b.line} — empty merged-from target`);
        continue;
      }
      if (!/^[\w./-]+:\d+$/.test(b.mergedFromTarget)) {
        malformed.push(`${b.file}:${b.line} — bad merged-from target '${b.mergedFromTarget}'`);
      }
    }

    expect(malformed, malformed.join("\n")).toEqual([]);
  });

  // Sanity: confirm the scanner is actually loading something. If both
  // dirs come back empty, the assertion above is vacuously true and a
  // future regression would slip through silently.
  it("scans both target directories (regression: scanner must see real files)", () => {
    const cliFiles = listTestFiles(CLI_DIR);
    const skillsFiles = listTestFiles(SKILLS_DIR);
    expect(cliFiles.length, "tests/cli/ has no test files").toBeGreaterThan(0);
    expect(skillsFiles.length, "tests/skills/ has no test files").toBeGreaterThan(0);
  });
});
