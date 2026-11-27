/**
 * KJC-BUG-0347 (#2101): the diff a reviewer or Solomon READS. A generated file
 * (lockfile, build output, snapshot) enters as one summary line instead of its
 * thousands of lines: the reviewer kept losing the real hunks behind a 4800-line
 * package-lock.json, and Solomon's prompt blew the argument limit (E2BIG).
 * The verdict still binds to the full diff; this only shapes the prompt.
 */
import { isGenerated } from "./loc-budget.js";

const HEADER = /^diff --git a\/(.+?) b\/(.+)$/;

/**
 * @param {string} diff unified diff
 * @param {Iterable<string>} [extra] more files to summarize: what the repo marks generated (HU-4976)
 * @returns {string}
 */
export function summarizeGeneratedFiles(diff, extra = []) {
  const marked = new Set(extra);
  const sections = String(diff).split(/(?=^diff --git )/m);
  let changed = false;
  const out = sections.map((sec) => {
    const file = sec.split("\n", 1)[0].match(HEADER)?.[2];
    if (!file || !(isGenerated(file) || marked.has(file))) return sec;
    changed = true;
    const lines = sec.split("\n");
    const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    return `diff --git a/${file} b/${file}\n# ${file}: generated file, +${added} -${removed} lines, contents left out of this prompt\n`;
  });
  return changed ? out.join("") : diff;
}
