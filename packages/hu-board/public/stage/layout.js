// ADR 0047: where everything stands in the factory hall, in metres. The line runs
// along x; the stations stand behind it, the crew on the floor beyond its ends.
export const LINE = { from: -8, to: 8, z: 1.1, width: 0.9, height: 0.55 };
export const STATION_X = [-6.3, -4.2, -2.1, 0, 2.1, 4.2, 6.3];
/** The piece that works each station, in the film's order (crew.js builds them in it). */
export const STATIONS = ['tdd', 'sentinel', 'review', 'gates', 'sonar', 'ledger', 'steward'];
export const STATION_Z = -0.7;
/** A piece's plinth is 1 m wide before scaling (cast/piece.js). */
export const PLINTH_WIDTH = 1;
/** Pieces and robots are drawn for different shots in the film: these bring them to one height. */
export const SCALE = { piece: 1.6, crew: 0.72, stand: 1.3 };
/** Where each member of the crew works at rest: Karajan dispatches, kaRAGan reads, kaWATCHan patrols. */
export const CREW = {
  conductor: { x: -9.4, z: 1.8, yaw: 0.9 },
  rag: { x: -9, z: -2.2, yaw: 0.5 },
  watch: { x: 9.4, z: 2.4, yaw: -0.8 },
};
export const STAND = { x: -10.6, z: -2.8, yaw: 0.7 };
