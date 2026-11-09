/**
 * KJC-TSK-1472: the human's mailbox. A lane has mail while it holds a pending
 * handoff (kj handoff add, src/harden/handoff.js): something only the human
 * can do. Each handoff is .karajan/handoffs/<8 hex>.json; done ones stay there.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const HANDOFFS_DIR = ['.karajan', 'handoffs'];
const HANDOFF_FILE = /^[0-9a-f]{8}\.json$/;

const isPending = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8'))?.status === 'pending'; } catch { return false; }
};

/** How many pending handoffs the lane at `projectDir` holds; 0 without its folder. */
export function pendingMail(projectDir) {
  const dir = join(projectDir, ...HANDOFFS_DIR);
  let names;
  try { names = readdirSync(dir); } catch { return 0; }
  return names.filter((n) => HANDOFF_FILE.test(n) && isPending(join(dir, n))).length;
}
