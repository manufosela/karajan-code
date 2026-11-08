// KJC-TSK-1462 (ADR 0050, point 3): a card in progress stays over its lane's bench while
// the work lasts, once the robot that fetched it has arrived. bench-notes-layout.js says where.
import { benchSpots } from './bench-notes-layout.js';
import { cardNote } from './couriers.js';

const SIZE = 0.5; // the courier's note, at the scale of the crew
const OVER_BENCH = 0.75;

/** The notes over the benches of one factory, mounted on `scene` (the factory's group on the map). */
export function createBenchNotes(scene) {
  const notes = new Map();
  return {
    /** Puts each card in progress over its bench; `carried` are the ids a robot still holds. */
    frame(cards, xOf, carried) {
      const spots = benchSpots(cards, xOf, carried);
      const here = new Set(spots.map((s) => s.id));
      for (const [id, note] of notes) {
        if (here.has(id)) continue;
        scene.remove(note);
        note.geometry.dispose();
        note.material.map.dispose();
        note.material.dispose();
        notes.delete(id);
      }
      for (const { id, x, z } of spots) {
        if (!notes.has(id)) {
          const note = cardNote(id);
          note.scale.setScalar(SIZE);
          note.rotation.x = -0.4; // tilted up towards the camera
          scene.add(note);
          notes.set(id, note);
        }
        notes.get(id).position.set(x, OVER_BENCH, z);
      }
    },
  };
}
