/**
 * diff-batches (KJC-BUG-0378, #2263): a third-party PR can be far larger than
 * what one reviewer prompt holds (the reviewer clips at DIFF_CLIP_CHARS). The
 * diff is cut at each file and whole files are packed into batches that fit, so
 * every batch is reviewed complete. A file larger than the limit, or files past
 * the batch cap, are not reviewed and are named in the coverage, never hidden.
 */

// HU-4944: a file is named by its b/ path, as diffFacts and findings name it, renames included.
const FILE_HEAD = /^diff --git a\/.+? b\/(.+)$/;

// KJC-BUG-0378: a reviewer call per batch; past this many, files are left out and named.
export const MAX_REVIEW_BATCHES = 10;

/** The diff cut at each file, with the number of changed lines in each. */
export function splitByFile(diff) {
  const parts = [];
  for (const line of String(diff).split("\n")) {
    const head = FILE_HEAD.exec(line);
    if (head) parts.push({ file: head[1], lines: [] });
    if (parts.length === 0) continue;
    parts.at(-1).lines.push(line);
  }
  return parts.map(({ file, lines }) => ({ file, text: lines.join("\n"), changed: changedLines(lines) }));
}

const HUNK_HEAD = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/**
 * KJC-BUG-0384: one hunk cut into windows that fit `room` characters with their own
 * `@@ -old,count +new,count @@` header, so the reviewer reads the right line numbers.
 * A single line that cannot fit stays alone in a window larger than the room, which
 * batchDiff leaves out and names; no batch ever exceeds the limit.
 */
function splitHunk(lines, budget) {
  const head = HUNK_HEAD.exec(lines[0]);
  if (!head) return [lines];
  // The rewritten header: the original's trailing context plus four line numbers of up to 10 digits.
  const room = budget - (head[3].length + 50);
  let oldAt = Number(head[1]);
  let newAt = Number(head[2]);
  const windows = [];
  let cur = [];
  let size = 0;
  const flush = () => {
    const oldCount = cur.filter((l) => l[0] === " " || l[0] === "-").length;
    const newCount = cur.filter((l) => l[0] === " " || l[0] === "+").length;
    windows.push([`@@ -${oldAt},${oldCount} +${newAt},${newCount} @@${head[3]}`, ...cur]);
    oldAt += oldCount;
    newAt += newCount;
    cur = [];
    size = 0;
  };
  for (const line of lines.slice(1)) {
    if (cur.length > 0 && size + line.length + 1 > room) flush();
    cur.push(line);
    size += line.length + 1;
  }
  if (cur.length > 0) flush();
  return windows;
}

const changedLines = (lines) => lines.filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).length;

/**
 * Whole files packed into batches of at most `limit` characters, at most
 * `maxBatches` of them, and the coverage that leaves.
 */
export function batchDiff(diff, { limit, maxBatches }) {
  const parts = splitByFile(diff);
  const batches = [];
  const left = [];
  for (const piece of packingOrder(parts, limit)) {
    const last = batches.at(-1);
    if (piece.text.length > limit) left.push(piece);
    else if (last && last.text.length + 1 + piece.text.length <= limit) last.add(piece);
    else if (batches.length < maxBatches) batches.push(newBatch(piece));
    else left.push(piece);
  }
  // A file counts as reviewed only when every piece of it was.
  const missing = new Set(left.map((p) => p.file));
  const sum = (ps) => ps.reduce((n, p) => n + p.changed, 0);
  const reviewedLines = sum(batches.flatMap((b) => b.parts));
  return {
    batches: batches.map((b) => ({ files: [...new Set(b.parts.map((p) => p.file))], text: b.text })),
    coverage: {
      files: { reviewed: parts.length - missing.size, total: parts.length },
      lines: { reviewed: reviewedLines, total: reviewedLines + sum(left) },
      truncated: missing.size > 0,
      unreviewed: parts.map((p) => p.file).filter((f) => missing.has(f)),
      ...(missing.size > 0 && { unreviewedReasons: reasonsOf(left, limit) }),
    },
  };
}

/** HU-4976: files that fit whole go first, smallest first, so a cut file never takes their place under the cap. */
function packingOrder(parts, limit) {
  const fits = (part) => part.text.length <= limit;
  const whole = parts.filter(fits).toSorted((a, b) => a.text.length - b.text.length);
  return [...whole, ...parts.filter((p) => !fits(p)).flatMap((p) => piecesOf(p, limit))];
}

/** Why each file was left out: a piece no prompt can hold, or no room under the batch cap. */
function reasonsOf(left, limit) {
  const tooLarge = new Set(left.filter((p) => p.text.length > limit).map((p) => p.file));
  return Object.fromEntries(left.map((p) => [p.file, tooLarge.has(p.file) ? "too-large" : "batch-cap"]));
}

/**
 * KJC-BUG-0382 (#2263): a file too large for one batch is cut into pieces of whole
 * hunks, each with the file's header, so it is reviewed whole. A single hunk larger
 * than the limit stays one piece and is left out (named in the coverage).
 */
function piecesOf(part, limit) {
  if (part.text.length <= limit) return [part];
  const lines = part.text.split("\n");
  const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
  if (firstHunk === -1) return [part];
  const header = lines.slice(0, firstHunk).join("\n");
  const hunks = [];
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith("@@")) hunks.push([]);
    hunks.at(-1).push(line);
  }
  const pieces = [];
  // KJC-BUG-0384: a hunk larger than a batch (a new file is one hunk) is cut by lines.
  const room = limit - header.length - 1;
  const fitted = hunks.flatMap((h) => (h.join("\n").length > room ? splitHunk(h, room) : [h]));
  for (const hunk of fitted.map((h) => h.join("\n"))) {
    const last = pieces.at(-1);
    if (last && last.text.length + 1 + hunk.length <= limit) last.text = `${last.text}\n${hunk}`;
    else pieces.push({ file: part.file, text: `${header}\n${hunk}` });
  }
  return pieces.map((p) => ({ ...p, changed: changedLines(p.text.split("\n")) }));
}

function newBatch(first) {
  const batch = {
    parts: [first],
    text: first.text,
    add(part) {
      batch.parts.push(part);
      batch.text = `${batch.text}\n${part.text}`;
    },
  };
  return batch;
}
