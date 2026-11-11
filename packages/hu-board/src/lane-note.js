/**
 * KJC-TSK-1541 (issue 3853): the note `kj worktree note` leaves on a lane (src/hu/lane-note.js
 * of kj), read from the main checkout. It is text to show and nothing else, so it is cleaned
 * again here: whoever wrote the file, the stage gets one plain line.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LANE_NOTES_DIR = ['.karajan', 'lane-notes'];
const MAX_NOTE = 120;

/** The note of `lane` in the project at `projectDir`, or null without a readable one. */
export function laneNote(projectDir, lane) {
  let note;
  try { ({ note } = JSON.parse(readFileSync(join(projectDir, ...LANE_NOTES_DIR, `${lane}.json`), 'utf8'))); } catch { return null; }
  if (typeof note !== 'string') return null;
  const clean = note.replaceAll(/\p{Cc}/gu, ' ').replaceAll(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
  return clean || null;
}
