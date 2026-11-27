// KJC-TSK-1815: a piece that is Karajan's robot in costume, with createPiece's { group, setLight }.
import * as THREE from 'three';
import { createRobot } from './cast/robot.js';
import { RED } from './cast/props.js';
import { ROBOTS } from './crew.js';
import { SCALE } from './layout.js';
import { dressPiece } from './piece-costume-mesh.js';

/** Karajan's robot dressed in `costume`, sized so place(group, ..., SCALE.piece) leaves it at the crew's size. */
export function createCostumedPiece(id, costume) {
  const robot = createRobot({ ...ROBOTS.find(([key]) => key === 'conductor')[1], name: id });
  const { trim } = dressPiece(robot, costume);
  const own = trim.color.clone();
  robot.root.scale.setScalar(SCALE.crew / SCALE.piece);
  const group = new THREE.Group();
  group.add(robot.root);
  return {
    group,
    /** gold: earned light (0..1); red: refusal flash (0..1). */
    setLight(gold, red = 0) {
      robot.setGlow(0.6 + 0.8 * Math.max(gold, red));
      trim.emissive.copy(own).multiplyScalar(gold * 0.5).lerp(RED, red);
    },
  };
}
