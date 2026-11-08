// KJC-TSK-1433 (ADR 0048): zoom in and out with the wheel and with a pinch,
// within limits. Pure: the scene multiplies the camera's framing by the zoom.
export const ZOOM = { min: 0.35, max: 1.6 };

const clamp = (k, { min, max }) => Math.min(max, Math.max(min, k));

/** The zoom after a wheel step: down (positive deltaY) moves away, up comes closer. */
export const wheelZoom = (zoom, deltaY, limits = ZOOM) => clamp(zoom * Math.exp(deltaY * 0.0015), limits);

/** The zoom after a pinch from `from` to `to` px between the fingers: apart comes closer. */
export const pinchZoom = (zoom, from, to, limits = ZOOM) => (from > 0 && to > 0 ? clamp((zoom * from) / to, limits) : zoom);

/**
 * Listens to the wheel and to two-finger pinches on `el`; `onZoom(k)` gets each new zoom.
 * The map passes deeper `limits`, down to one workshop (KJC-TSK-1454).
 */
export function listenZoom(el, onZoom, limits = ZOOM) {
  let zoom = 1;
  let gap = 0;
  const span = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = wheelZoom(zoom, e.deltaY, limits);
    onZoom(zoom);
  }, { passive: false });
  el.addEventListener('touchstart', (e) => { if (e.touches.length === 2) gap = span(e.touches); });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const next = span(e.touches);
    zoom = pinchZoom(zoom, gap, next, limits);
    onZoom(zoom);
    gap = next;
  }, { passive: false });
  return () => zoom;
}

/**
 * KJC-TSK-1454 (ADR 0049): where the camera looks after a drag of (dx, dy) px, when one
 * px covers `metresPerPx`: the map follows the pointer and the point looked at stays inside
 * `bounds`. Only that point: a factory on the edge can still be centred, with the void beside it.
 */
export function panTarget({ x, z }, dx, dy, metresPerPx, { width, depth }) {
  const inside = (v, half) => Math.min(half, Math.max(-half, v));
  return { x: inside(x - dx * metresPerPx, width / 2), z: inside(z - dy * metresPerPx, depth / 2) };
}

/** Calls `onDrag(dx, dy)` while one pointer (mouse button or finger) drags on `el`; two fingers zoom. */
export function listenPan(el, onDrag) {
  const down = new Map();
  el.addEventListener('pointerdown', (e) => { down.set(e.pointerId, e); el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    const last = down.get(e.pointerId);
    if (!last) return;
    down.set(e.pointerId, e);
    if (down.size === 1) onDrag(e.clientX - last.clientX, e.clientY - last.clientY);
  });
  for (const type of ['pointerup', 'pointercancel']) el.addEventListener(type, (e) => down.delete(e.pointerId));
}
