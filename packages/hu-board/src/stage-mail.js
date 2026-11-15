/**
 * KJC-TSK-1472: the human's mailbox. A lane has mail while it holds a pending
 * handoff (kj handoff add, src/harden/handoff.js): something only the human
 * can do. Each handoff is .karajan/handoffs/<8 hex>.json; done ones stay there.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const HANDOFFS_DIR = ['.karajan', 'handoffs'];
const HANDOFF_FILE = /^[0-9a-f]{8}\.json$/;

/** The longest text a handoff passes to the stage, in characters (KJC-TSK-1638). */
export const HANDOFF_TEXT = 160;

const readRecord = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
};

const cut = (text) => {
  if (typeof text !== 'string' || !text) return null;
  return text.length > HANDOFF_TEXT ? `${text.slice(0, HANDOFF_TEXT - 1)}…` : text;
};

/** The pending handoff records of the lane at `projectDir`; none without its folder. */
function pendingRecords(projectDir) {
  const dir = join(projectDir, ...HANDOFFS_DIR);
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => HANDOFF_FILE.test(n)).map((n) => readRecord(join(dir, n))).filter((r) => r?.status === 'pending');
}

/** How many pending handoffs the lane at `projectDir` holds; 0 without its folder. */
export const pendingMail = (projectDir) => pendingRecords(projectDir).length;

/**
 * KJC-TSK-1638: what each pending handoff of the lane asks, oldest first, for the mailbox's
 * tooltip: what to do (a denial's own why), its command, its kind and since when; texts cut.
 */
export function pendingHandoffs(projectDir) {
  return pendingRecords(projectDir)
    .map((r) => ({
      id: r.id,
      kind: r.kind === 'denial' ? 'denial' : 'task',
      why: cut(r.kind === 'denial' ? r.denial?.why : r.why),
      command: cut(r.command),
      since: typeof r.createdAt === 'string' ? r.createdAt : null,
    }))
    .toSorted((a, b) => (a.since ?? '').localeCompare(b.since ?? ''));
}
