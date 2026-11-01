// KJC-TSK-1356 (#3027): how big a third-party PR is, in CODE, and whether it is past the exceptional
// ceiling past which kj does not review it. Karajan's norm is atomic PRs (the split advice aims at
// the repo's PR budget); the ceiling is the exception, not the target.
import { isGenerated } from "./loc-budget.js";

export const MAX_CODE_LINES = 800;
export const MAX_CODE_FILES = 20;

// Markdown, docs and JSON never count, nor anything generated (lockfiles, build output...).
const NOT_CODE = /\.(md|mdx|markdown|txt|rst|adoc|json|jsonc)$/i;

/** @param {string} file */
export const countsAsCode = (file) => Boolean(file) && !isGenerated(file) && !NOT_CODE.test(file);

const positive = (value, key) => {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`review.third_party.${key} must be a positive integer, got ${JSON.stringify(value)}`);
  return value;
};

/** The ceiling: review.third_party.max_lines / max_files, or 800 lines / 20 files. */
export function ceilingOf(config) {
  const t = config?.review?.third_party ?? {};
  return {
    maxLines: positive(t.max_lines, "max_lines") ?? MAX_CODE_LINES,
    maxFiles: positive(t.max_files, "max_files") ?? MAX_CODE_FILES,
  };
}

/** @param {Array<{file: string, changed: number}>} files from splitByFile */
export function measureCode(files) {
  const code = files.filter((f) => countsAsCode(f.file));
  return { codeLines: code.reduce((n, f) => n + f.changed, 0), codeFiles: code.length, otherFiles: files.length - code.length };
}

export const isTooLarge = (size, ceiling) => size.codeLines > ceiling.maxLines || size.codeFiles > ceiling.maxFiles;

/** What the consumer posts instead of a review. */
export function tooLargeSummary(size, ceiling, budget) {
  return `Too large to review well: ${size.codeLines} lines of code in ${size.codeFiles} files `
    + `(ceiling ${ceiling.maxLines} lines / ${ceiling.maxFiles} files, an exception, never the norm). `
    + `Karajan recommends atomic PRs of about ${budget} lines of code, one purpose each: split it as advised.`;
}
