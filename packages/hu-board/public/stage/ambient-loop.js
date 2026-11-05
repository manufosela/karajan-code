// KJC-TSK-1420 (ADR 0047): plays the ambient life of the factory frame by frame.
// requestAnimationFrame stops on its own while the tab is hidden, and the pose is
// a pure function of time, so the hall picks up where it should on return.
import * as THREE from 'three';
import { ROUTES, bubbleAt, poseAt } from './ambient.js';

/** Height of a robot's head above the floor, at the crew scale. */
const HEAD_Y = 2.1;

/** Shows the line being said over the speaker's head, or hides the bubble. */
function placeBubble(bubble, said, crew, camera) {
  if (!said) { bubble.hidden = true; return; }
  const { x, z } = crew[said.who].root.position;
  const at = new THREE.Vector3(x, HEAD_Y, z).project(camera);
  bubble.textContent = said.text;
  bubble.style.left = `${((at.x + 1) / 2) * innerWidth}px`;
  bubble.style.top = `${((1 - at.y) / 2) * innerHeight}px`;
  bubble.hidden = false;
}

/** Starts the loop; `onFrame(ms)` runs before each render (the live crates). */
export function runAmbient({ crew, pieces, camera, render }, bubble, onFrame = () => {}) {
  const stations = Object.values(pieces);
  const frame = (ms) => {
    const t = ms / 1000;
    for (const [id, robot] of Object.entries(crew)) {
      const { x, z, yaw, walking } = poseAt(ROUTES[id], t);
      robot.root.position.set(x, 0, z);
      robot.root.rotation.y = yaw;
      const step = walking ? Math.sin(t * 9) : 0;
      robot.hover.position.y = 0.1 + 0.06 * Math.abs(step);
      robot.pose('L', 0.15, 0.4 * step);
      robot.pose('R', 0.15, -0.4 * step);
    }
    // Each station works at its own pace: arms half raised, as if handling the piece.
    stations.forEach((piece, i) => piece.catch(0.12 + 0.1 * Math.sin(t * 1.6 + i)));
    placeBubble(bubble, bubbleAt(t), crew, camera);
    onFrame(ms);
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
