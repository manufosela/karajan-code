// KJC-TSK-1817 (ADR "kj stage en una línea", accepted 2026-11-27, decided by the maintainer): the hall
// in one line, left to right, nothing behind anything, the camera in front.
// The next PRs place each group from this module.
import { STATIONS, WORKSHOP } from './hall-sizes.js';

/** The z the whole line stands on, and the aisle in front of it where robots walk. */
export const LINE = { z: -1, aisleZ: 2.6 };
/** The groups, left to right. */
export const LINE_ORDER = ['booth', 'team', 'pieces', 'lanes', 'wall', 'release', 'mailbox', 'warehouse'];

/** Width in metres of each group; the lanes depend on their number, so they are computed. */
const WIDTHS = Object.freeze({
  booth: 2.4, // the teleport booth
  team: 5, // kaRAGan, atril, Karajan and his console
  pieces: STATIONS.length * 1.1, // one post each
  wall: 4,
  release: 5.5, // table, counter, kaWATCHan
  mailbox: 2,
  warehouse: 4,
});
/** The gap between groups, in metres. */
const GAP = 0.6;

const widthOf = (id, lanes) => (id === 'lanes' ? lanes * (WORKSHOP.width + WORKSHOP.gap) : WIDTHS[id]);

/** Where the lanes start: the left edge of the hall's first column of four workshops, centred on x = 0. */
const LANES_FROM = -2 * (WORKSHOP.width + WORKSHOP.gap);

/** The groups laid from the lanes outwards: [{ id, from, to }]. A factory shows at least one lane. */
export function lineGroups(n) {
  const lanes = Math.max(1, Math.floor(n));
  const at = LINE_ORDER.indexOf('lanes');
  const groups = [];
  groups[at] = { id: 'lanes', from: LANES_FROM, to: LANES_FROM + widthOf('lanes', lanes) };
  for (let i = at - 1; i >= 0; i--) {
    const to = groups[i + 1].from - GAP;
    groups[i] = { id: LINE_ORDER[i], from: to - widthOf(LINE_ORDER[i], lanes), to };
  }
  for (let i = at + 1; i < LINE_ORDER.length; i++) {
    const from = groups[i - 1].to + GAP;
    groups[i] = { id: LINE_ORDER[i], from, to: from + widthOf(LINE_ORDER[i], lanes) };
  }
  return groups;
}

export const lineWidth = (n) => {
  const groups = lineGroups(n);
  return groups.at(-1).to - groups[0].from;
};

export const lineCentre = (n) => {
  const groups = lineGroups(n);
  return (groups.at(-1).to + groups[0].from) / 2;
};
