/**
 * split-signal — KJC-BUG-0138 (issue #1364). A file split is not a coverage
 * deletion, but the reviewer doesn't correlate a file losing content with new
 * files gaining it (4/13 pure-refactor PRs falsely rejected). Deterministic
 * pre-analysis, zero LLM: significant removed lines reappearing verbatim among
 * another file's ADDITIONS in the same diff are moves — when ≥ MIN_RATIO of a
 * file's removals move, the reviewer gets the correlation as a pipeline note.
 * Exact `--- a/` / `+++ b/` headers only (BUG-0132: `++content` ≠ header).
 */

const MIN_REMOVED = 10; // fewer significant removals ⇒ too small to misread
const MIN_RATIO = 0.5; // below this, the removal is mostly a real removal

// Braces/punctuation reappear by accident — only letter-bearing lines count.
function significant(text) {
  const t = text.trim();
  return t.length >= 10 && /[a-zA-Z]/.test(t);
}

/** @returns {string|null} pipeline note, or null when nothing moved. Feed the
 * PRE-CLIPPING diff: the added side must inform even when clipped away. */
export function buildSplitSignal(diff) {
  if (!diff) return null;
  const removedByFile = new Map();
  const addedByFile = new Map();
  let src = null;
  let dst = null;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("--- ")) {
      src = raw.startsWith("--- a/") ? raw.slice(6) : null;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      dst = raw.startsWith("+++ b/") ? raw.slice(6) : null;
      continue;
    }
    if (raw.startsWith("+") && dst && significant(raw.slice(1))) {
      const counts = addedByFile.get(dst) ?? new Map();
      const t = raw.slice(1).trim();
      counts.set(t, (counts.get(t) ?? 0) + 1);
      addedByFile.set(dst, counts);
    } else if (raw.startsWith("-") && src && significant(raw.slice(1))) {
      const lines = removedByFile.get(src) ?? [];
      lines.push(raw.slice(1).trim());
      removedByFile.set(src, lines);
    }
  }

  const findings = [];
  for (const [file, removed] of removedByFile) {
    if (removed.length < MIN_REMOVED) continue;
    const dests = new Map();
    let moved = 0;
    for (const text of removed) {
      for (const [other, counts] of addedByFile) {
        if (other === file) continue; // in-place edits are not moves
        const n = counts.get(text) ?? 0;
        if (n > 0) {
          counts.set(text, n - 1); // each added line vouches for ONE removal
          dests.set(other, (dests.get(other) ?? 0) + 1);
          moved++;
          break;
        }
      }
    }
    if (moved / removed.length >= MIN_RATIO) {
      const where = [...dests.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([d, n]) => `${d} (${n})`)
        .join(", ");
      findings.push(`- ${file}: ${moved} of ${removed.length} significant removed lines reappear ADDED in ${where}`);
    }
  }
  if (findings.length === 0) return null;

  return [
    "NOTE FROM THE KJ PIPELINE (deterministic pre-analysis, not from the author): this diff MOVES content between files:",
    ...findings,
    "Moved content is a file split/relocation, not a deletion. Before reporting removed tests or lost coverage, check the ADDED side listed above in this SAME diff. Do not treat moved lines as deleted.",
  ].join("\n");
}
