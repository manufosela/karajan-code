// KJC-TSK-1817 (ADR "kj stage en una línea", accepted 2026-11-27, decided by the maintainer): the hall
// seen from the front, the camera in front.
// KJC-TSK-1842 (decision 4 revised, 2026-11-28): two rows. Behind, Karajan's side (booth, team, pieces,
// wall, release, mailbox); in front, the workshops. Both start at the lanes' left edge, and the
// warehouse stands right of whichever row ends later. Each group is placed from this module.
import { STATIONS, WORKSHOP } from './hall-sizes.js';

/** The z the whole line stands on, and the aisle in front of it where robots walk. */
export const LINE = { z: -1, aisleZ: 2.6 };
/** The groups, in the order lineGroups returns them. */
export const LINE_ORDER = ['booth', 'team', 'pieces', 'lanes', 'wall', 'release', 'mailbox', 'warehouse'];

/** Width in metres of each group; the lanes depend on their number, so they are computed. */
const WIDTHS = Object.freeze({
  booth: 2.4, // the teleport booth
  team: 5, // kaRAGan, atril, Karajan and his console
  pieces: STATIONS.length * 1.1, // one post each
  wall: 3.6, // its board is 3.4
  release: 4.3, // table, counter, kaWATCHan
  mailbox: 1.4,
  warehouse: 4,
});
/** The gap between groups, in metres. */
// KJC-TSK-1842 (the maintainer, 2026-11-28: "no quiero huecos"): no gap between groups.
const GAP = 0;

const widthOf = (id, lanes) => (id === 'lanes' ? lanes * (WORKSHOP.width + WORKSHOP.gap) : WIDTHS[id]);

/** Where the lanes start: the left edge of the hall's first column of four workshops, centred on x = 0. */
const LANES_FROM = -2 * (WORKSHOP.width + WORKSHOP.gap);

/** Karajan's row, behind the workshops, left to right. */
const BACK_ROW = ['booth', 'team', 'pieces', 'wall', 'release', 'mailbox'];

/** The groups in LINE_ORDER: [{ id, from, to }]. Both rows start at the lanes' left edge; a factory shows at least one lane. */
export function lineGroups(n) {
  const lanes = Math.max(1, Math.floor(n));
  const spans = { lanes: { from: LANES_FROM, to: LANES_FROM + widthOf('lanes', lanes) } };
  let edge = LANES_FROM;
  for (const id of BACK_ROW) {
    spans[id] = { from: edge, to: edge + widthOf(id, lanes) };
    edge = spans[id].to + GAP;
  }
  const from = Math.max(spans.lanes.to, spans.mailbox.to) + GAP;
  spans.warehouse = { from, to: from + widthOf('warehouse', lanes) };
  return LINE_ORDER.map((id) => ({ id, ...spans[id] }));
}

export const lineWidth = (n) => {
  const groups = lineGroups(n);
  return groups.at(-1).to - groups[0].from;
};

export const lineCentre = (n) => {
  const groups = lineGroups(n);
  return (groups.at(-1).to + groups[0].from) / 2;
};
