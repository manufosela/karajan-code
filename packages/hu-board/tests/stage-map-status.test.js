// KJC-TSK-1466: on the map the status list speaks only to screen readers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../public/stage.html');
const main = read('../public/stage/main.js');

describe('the status list on the map', () => {
  it('is hidden from sight but kept for screen readers', () => {
    expect(page).toMatch(/#stage-status\.stage-unseen \{[^}]*clip-path: inset\(50%\)/);
    expect(page).toContain('<ul id="stage-status" aria-live="polite">');
    expect(page).not.toMatch(/\.stage-unseen \{[^}]*display: none/);
  });

  it('hides only once the map is up, so an error before or while it starts still shows', () => {
    const view = main.slice(main.indexOf('async function startMapView'));
    const hide = view.indexOf("status.classList.add('stage-unseen')");
    expect(hide).toBeGreaterThan(view.indexOf('startMap({'));
    expect(hide).toBeLessThan(view.indexOf('} catch'));
  });
});
