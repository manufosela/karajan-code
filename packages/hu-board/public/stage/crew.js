// ADR 0047: who works the factory hall. The film's seven pieces are the stations
// of the line; Karajan, kaRAGan and kaWATCHan work the floor, with atril by kaRAGan.
import { CREW, SCALE, STAND, STATION_X, STATION_Z, STATIONS } from './layout.js';
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

// The film's seven pieces: the stations of the line, in the order of layout.js.
const LOOKS = {
  tdd: ['TDD', 'tool', tddBody], sentinel: ['Sentinel', 'method', sentinelBody],
  review: ['AI review', 'method', reviewBody], gates: ['Git gates', 'method', gatesBody],
  sonar: ['SonarQube', 'tool', sonarBody], ledger: ['Ledger', 'method', ledgerBody],
  steward: ['Steward', 'method', stewardBody],
};
const PIECES = STATIONS.map((id) => [id, ...LOOKS[id]]);
// The film's accents: Karajan green, kaRAGan amber, kaWATCHan blue.
const ROBOTS = [
  ['conductor', { accent: 0x34e07f, bow: 0xeef1f6, name: 'Karajan Code' }],
  ['rag', { accent: 0xf0b429, name: 'kaRAGan' }],
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
    place(piece.group, { x: STATION_X[i], z: STATION_Z }, SCALE.piece);
    piece.setLight(0);
    return [id, piece];
  }));
  scene.add(stand.group, ...Object.values(crew).map((r) => r.root), ...Object.values(pieces).map((p) => p.group));
  return { crew, pieces, stand };
}
