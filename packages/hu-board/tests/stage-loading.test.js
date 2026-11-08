// KJC-TSK-1468: a loading indicator until the stage says its first word.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../public/stage.html');
const main = read('../public/stage/main.js');

describe('the stage loading indicator', () => {
  it('shows from the first paint and is announced to screen readers', () => {
    expect(page).toMatch(/<output id="stage-loading" aria-live="polite">[^<]*Loading/);
    expect(page).not.toMatch(/id="stage-loading"[^>]*hidden/);
  });

  it('goes once the page tells anything (the scene is up, or an error), after that frame', () => {
    const tell = main.slice(main.indexOf('const tell ='), main.indexOf('\n', main.indexOf('const tell =')));
    expect(tell).toContain('loaded()');
    expect(main).toMatch(/const loaded = \(\) => requestAnimationFrame\(\(\) => \{ loading\.hidden = true; \}\)/);
  });
});
