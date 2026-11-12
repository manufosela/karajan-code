/**
 * KJC-TSK-1565 (ADR 0056): the board keeps this person's avatar (an emblem and a colour per
 * role) in <karajan home>/hu-board/avatar.json, cleaned on the way in and on the way out.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanAvatar } from '../public/stage/avatars.js';

const fileOf = (home) => join(home, 'hu-board', 'avatar.json');

/** The saved avatar, or none when there is no file or it cannot be read. */
export function readAvatar(home) {
  try { return cleanAvatar(JSON.parse(readFileSync(fileOf(home), 'utf8'))); } catch { return cleanAvatar(null); }
}

/** Saves the cleaned `value` and returns what was saved. */
export function saveAvatar(home, value) {
  const avatar = cleanAvatar(value);
  mkdirSync(join(home, 'hu-board'), { recursive: true });
  writeFileSync(fileOf(home), `${JSON.stringify(avatar, null, 2)}\n`);
  return avatar;
}
