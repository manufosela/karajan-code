/**
 * KJC-TSK-1541 (issue 3853): a short note on a lane, what it waits for, written by
 * `kj worktree note <slug> "<text>"`. It lives in the main checkout, where the board reads it
 * (packages/hu-board/src/lane-note.js), and kj stage shows it as text, never as an instruction.
 */
import fs from "node:fs";
import path from "node:path";

export const LANE_NOTES_DIR = [".karajan", "lane-notes"];
const LANES_DIR = [".kj", "worktrees"];
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_NOTE = 120;

/** The note as one line of plain text: no control characters, whitespace folded, cut to 120. */
export const cleanNote = (text) => String(text ?? "").replaceAll(/\p{Cc}/gu, " ").replaceAll(/\s+/g, " ").trim().slice(0, MAX_NOTE);

/** Writes (or, empty, clears) the note of lane `slug` of the main checkout at `mainDir`. */
export function writeLaneNote({ mainDir, slug, text, now = () => new Date().toISOString() }) {
  if (!SLUG_RE.test(String(slug ?? ""))) throw new Error(`invalid slug "${slug}": kj worktree note <slug> "<text>"`);
  if (!fs.existsSync(path.join(mainDir, ...LANES_DIR, slug))) throw new Error(`no lane "${slug}": see kj worktree list`);
  const file = path.join(mainDir, ...LANE_NOTES_DIR, `${slug}.json`);
  const note = cleanNote(text);
  if (!note) {
    fs.rmSync(file, { force: true });
    return { slug, note: null };
  }
  const at = now();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ note, at })}\n`);
  return { slug, note, at };
}

/**
 * Drops the note of lane `slug`: when the lane is retired, and when a lane is born with a slug
 * an older lane had, so it never inherits that lane's note.
 */
export function clearLaneNote(mainDir, slug) {
  if (SLUG_RE.test(String(slug ?? ""))) fs.rmSync(path.join(mainDir, ...LANE_NOTES_DIR, `${slug}.json`), { force: true });
}

/** What `kj worktree note` says it left. */
export const noteLine = ({ slug, note }) => (note ? `✓ note on ${slug}: ${note}` : `✓ note of ${slug} cleared`);
