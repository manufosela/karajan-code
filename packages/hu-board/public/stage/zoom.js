// KJC-TSK-1433 (ADR 0048): zoom in and out with the wheel and with a pinch,
// within limits. Pure: the scene multiplies the camera's framing by the zoom.
export const ZOOM = { min: 0.35, max: 1.6 };

const clamp = (k) => Math.min(ZOOM.max, Math.max(ZOOM.min, k));

/** The zoom after a wheel step: down (positive deltaY) moves away, up comes closer. */
export const wheelZoom = (zoom, deltaY) => clamp(zoom * Math.exp(deltaY * 0.0015));

/** The zoom after a pinch from `from` to `to` px between the fingers: apart comes closer. */
export const pinchZoom = (zoom, from, to) => (from > 0 && to > 0 ? clamp((zoom * from) / to) : zoom);

/** Listens to the wheel and to two-finger pinches on `el`; `onZoom(k)` gets each new zoom. */
export function listenZoom(el, onZoom) {
  let zoom = 1;
  let gap = 0;
  const span = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = wheelZoom(zoom, e.deltaY);
    onZoom(zoom);
  }, { passive: false });
  el.addEventListener('touchstart', (e) => { if (e.touches.length === 2) gap = span(e.touches); });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const next = span(e.touches);
    zoom = pinchZoom(zoom, gap, next);
    onZoom(zoom);
    gap = next;
  }, { passive: false });
  return () => zoom;
}
