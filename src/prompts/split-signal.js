/**
 * split-signal — KJC-BUG-0138 (issue #1364). A file split is not a coverage
 * deletion: the reviewer sees file A losing most of its content and new files
 * gaining it, and does not correlate the two sides — 4 of 13 pure-refactor
 * PRs were falsely rejected for "deleting tests", each costing a solomon
 * round. kj's own method (pr-size gate, partition guidance) PUSHES toward
 * exactly that refactor, so the review gate must not fight it.
 *
 * Deterministic pre-analysis over the raw diff, zero LLM: significant lines
 * removed from A that reappear verbatim among the ADDITIONS of another file
 * in the SAME diff are moves, not deletions. When at least half of a file's
 * significant removals move elsewhere, the reviewer gets the correlation as
 * a note from the pipeline. Exact `--- a/` / `+++ b/` headers only — the
 * BUG-0132 lesson: `++content` body lines must never read as headers.
 */

const MIN_REMOVED = 10; // fewer significant removals ⇒ too small to misread
const MIN_RATIO = 0.5; // below this, the removal is mostly a real removal

// Braces, blanks and punctuation reappear everywhere by accident — only
// letter-bearing lines of some length count as evidence of a move.
function significant(text) {
  const t = text.trim();
  return t.length >= 10 && /[a-zA-Z]/.test(t);
}

/**
 * @param {string|null} diff raw unified diff (pre-clipping — the added side
 *   must be visible to the signal even when the reviewer's copy is clipped)
 * @returns {string|null} pipeline note, or null when nothing moved
 */
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
