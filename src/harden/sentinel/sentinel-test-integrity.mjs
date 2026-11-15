// HU-4221 (docs/specs/test-integrity.md, slice 1): what changed between two versions of a test
// file, line by line. Pure: no imports, no I/O, no state. It never parses the code, so a string,
// comment or regex literal cannot hide an edit. Only whitespace is normalised: an edit of
// whitespace alone is not seen, inside a string literal too.

/** The non-blank lines of `text`, each with its runs of whitespace collapsed to one space and its ends trimmed. */
export const linesOf = (text) =>
  typeof text === "string" ? text.split(/\r\n?|\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean) : [];

/** A list from linesOf: null or undefined is an empty one, anything else is refused. */
const listOf = (lines) => {
  const list = lines ?? [];
  if (!Array.isArray(list)) throw new TypeError("compareLines takes the lists that linesOf returns");
  return list;
};

/** The [i, j] of each line a[i] === b[j] that a longest common subsequence keeps, then [a.length, b.length]. */
const keptPairs = (a, b) => {
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const kept = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) kept.push([i++, j++]);
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return [...kept, [a.length, b.length]];
};

/** What changed from `before` to `after`, two lists from linesOf. In each gap between two kept lines, its lines
 *  pair in order as `changed`; the rest are `removed` or `added`. `at` is 1-based, in `before` (in `after` for added). */
export const compareLines = (before, after) => {
  const [a, b] = [listOf(before), listOf(after)];
  const out = { added: [], changed: [], removed: [] };
  let [i, j] = [0, 0];
  for (const [keptI, keptJ] of keptPairs(a, b)) {
    for (; i < keptI && j < keptJ; i++, j++) out.changed.push({ before: a[i], after: b[j], at: i + 1 });
    for (; i < keptI; i++) out.removed.push({ line: a[i], at: i + 1 });
    for (; j < keptJ; j++) out.added.push({ line: b[j], at: j + 1 });
    [i, j] = [keptI + 1, keptJ + 1];
  }
  return out;
};
