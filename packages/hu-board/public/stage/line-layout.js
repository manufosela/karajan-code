// KJC-TSK-1817 (ADR "kj stage en una línea", accepted 2026-11-27, decided by the maintainer): the hall
// in one line, left to right, nothing behind anything, the camera in front.
// The next PRs place each group from this module.
import { STATIONS, WORKSHOP } from './layout.js';

/** The z the whole line stands on, and the aisle in front of it where robots walk. */
export const LINE = { z: -1, aisleZ: 2.6 };
/** The groups, left to right. */
export const LINE_ORDER = ['booth', 'team', 'pieces', 'lanes', 'wall', 'release', 'mailbox', 'warehouse'];

/** Width in metres of each group; the lanes depend on their number, so they are computed. */
const WIDTHS = Object.freeze({
  booth: 2.4, // the teleport booth
  team: 6, // kaRAGan, atril, Karajan and his console
  pieces: STATIONS.length * 1.6, // one post each
  wall: 4,
  release: 5.5, // table, counter, kaWATCHan
  mailbox: 2,
  warehouse: 4,
});
/** The gap between groups, in metres. */
const GAP = 1.2;

const widthOf = (id, lanes) => (id === 'lanes' ? lanes * (WORKSHOP.width + WORKSHOP.gap) : WIDTHS[id]);

/** The groups laid one after the other from x = 0: [{ id, from, to }]. A factory shows at least one lane. */
export function lineGroups(n) {
  const lanes = Math.max(1, Math.floor(n));
  let from = 0;
  return LINE_ORDER.map((id) => {
    const group = { id, from, to: from + widthOf(id, lanes) };
    from = group.to + GAP;
    return group;
  });
}

export const lineWidth = (n) => {
  const groups = lineGroups(n);
  return groups.at(-1).to - groups[0].from;
};

export const lineCentre = (n) => {
  const groups = lineGroups(n);
  return (groups.at(-1).to + groups[0].from) / 2;
};
