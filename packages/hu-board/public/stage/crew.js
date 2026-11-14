// ADR 0047, 0048: who works the factory hall. The film's seven pieces wait at
// their posts at the back; Karajan, kaRAGan and kaWATCHan at the ends of the
// row, with atril by kaRAGan. Nothing here moves on its own.
import { CREW, POST, SCALE, SENTINEL_POST, STAND, STATIONS, postX } from './layout.js';
import { createRobot } from './cast/robot.js';
import { createPiece } from './cast/piece.js';
import { createStand } from './cast/stand.js';
import { tddBody } from './cast/pieces/tdd.js';
import { sentinelBody } from './cast/pieces/sentinel.js';
import { reviewBody } from './cast/pieces/review.js';
import { gatesBody } from './cast/pieces/gates.js';
import { sonarBody } from './cast/pieces/sonar.js';
import { ledgerBody } from './cast/pieces/ledger.js';
import { stewardBody } from './cast/pieces/steward.js';

// The film's seven pieces, in the order of layout.js.
export const LOOKS = { // KJC-TSK-1618: the legend's portraits build them too
  tdd: ['TDD', 'tool', tddBody], sentinel: ['Sentinel', 'method', sentinelBody],
  review: ['AI review', 'method', reviewBody], gates: ['Git gates', 'method', gatesBody],
  sonar: ['SonarQube', 'tool', sonarBody], ledger: ['Ledger', 'method', ledgerBody],
  steward: ['Steward', 'method', stewardBody],
};
const PIECES = STATIONS.map((id) => [id, ...LOOKS[id]]);
// The film's accents: Karajan green, kaRAGan amber, kaWATCHan blue.
export const RAGAN_ACCENT = 0xf0b429; // KJC-TSK-1522: its laptop too
export const ROBOTS = [
  ['conductor', { accent: 0x34e07f, bow: 0xeef1f6, name: 'Karajan Code' }],
  ['rag', { accent: RAGAN_ACCENT, name: 'kaRAGan' }],
  ['watch', { accent: 0x4fb3e8, name: 'kaWATCHan' }],
];

const place = (object, { x, z, yaw = 0 }, scale) => {
  object.position.set(x, 0, z);
  object.rotation.y = yaw;
  object.scale.setScalar(scale);
  object.traverse((o) => { if (o.isMesh) o.castShadow = true; });
};

/** Puts the crew and the stations on the floor; returns both by id, every station at rest. */
export function populate(scene) {
  const crew = Object.fromEntries(ROBOTS.map(([id, look]) => {
    const robot = createRobot(look);
    place(robot.root, CREW[id], SCALE.crew);
    return [id, robot];
  }));
  const stand = createStand('atril', [['atril', 'skills'], ...PIECES.map(([, name]) => [name, 'skill'])]);
  place(stand.group, STAND, SCALE.stand);
  const pieces = Object.fromEntries(PIECES.map(([id, name, kind, body], i) => {
    const piece = createPiece(i, name, { kind, body });
    // ADR 0048: each piece waits at its post; the Sentinel watches from its raised one.
    if (id === 'sentinel') {
      place(piece.group, SENTINEL_POST, SCALE.piece);
      piece.group.position.y = SENTINEL_POST.height;
    } else place(piece.group, { x: postX(id), z: POST.z }, SCALE.piece);
    piece.setLight(0);
    return [id, piece];
  }));
  scene.add(stand.group, ...Object.values(crew).map((r) => r.root), ...Object.values(pieces).map((p) => p.group));
  return { crew, pieces, stand };
}
