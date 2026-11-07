// KJC-TSK-1447 (ADR 0049): the labels over the scene, placed in screen space. A
// factory may be mounted away from the scene origin (the map holds several), so
// a point of the factory is moved by its origin before it is projected.

/** A projected point (-1..1 on both axes) on a screen of `width` × `height`, in css pixels. */
export const onScreen = ({ x, y }, width, height) => ({ left: ((x + 1) / 2) * width, top: ((1 - y) / 2) * height });

/** A label at `position` of a factory whose origin is `origin` (none: the scene origin). */
export function tagAt(text, position, camera, { className = 'stage-count', origin } = {}) {
  const world = origin ? position.clone().add(origin) : position.clone();
  const { left, top } = onScreen(world.project(camera), innerWidth, innerHeight);
  const tag = Object.assign(document.createElement('span'), { textContent: text, className });
  tag.style.left = `${left}px`;
  tag.style.top = `${top}px`;
  return tag;
}
