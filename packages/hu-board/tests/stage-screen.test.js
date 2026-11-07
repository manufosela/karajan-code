// KJC-TSK-1447 (ADR 0049): a label lands on its own factory wherever the factory is mounted.
import { describe, expect, it } from 'vitest';

import { onScreen, tagAt } from '../public/stage/screen.js';

describe('onScreen', () => {
  it('maps the projected corners and centre to css pixels', () => {
    expect(onScreen({ x: -1, y: 1 }, 800, 600)).toEqual({ left: 0, top: 0 });
    expect(onScreen({ x: 0, y: 0 }, 800, 600)).toEqual({ left: 400, top: 300 });
    expect(onScreen({ x: 1, y: -1 }, 800, 600)).toEqual({ left: 800, top: 600 });
  });
});

describe('tagAt', () => {
  const point = (x, y, z) => ({
    x, y, z,
    clone: () => point(x, y, z),
    add: (o) => point(x + o.x, y + o.y, z + o.z),
    // A camera that only scales world metres down to the -1..1 square.
    project: () => ({ x: x / 10, y: y / 10 }),
  });
  globalThis.innerWidth = 1000;
  globalThis.innerHeight = 1000;
  globalThis.document = { createElement: () => ({ style: {} }) };

  it('places the label from the factory origin, not from the scene origin', () => {
    const tag = tagAt('x2', point(1, 2, 0), {}, { origin: point(3, 0, 0) });
    expect([tag.style.left, tag.style.top, tag.textContent, tag.className]).toEqual(['700px', '400px', 'x2', 'stage-count']);
  });

  it('places it at the point itself when the factory sits at the scene origin', () => {
    const tag = tagAt('n', point(0, 0, 0), {}, { className: 'stage-worker' });
    expect([tag.style.left, tag.style.top, tag.className]).toEqual(['500px', '500px', 'stage-worker']);
  });
});
