// KJC-TSK-1839: since the wall drone carries every card (KJC-TSK-1832), no host walks a card to the
// task wall: its errand, the card in its hand and the passage to the wall are gone.
import { describe, expect, it } from 'vitest';

import * as layout from '../public/stage/layout.js';
import * as workers from '../public/stage/workers.js';

describe('no host errand to the wall', () => {
  it('has no errand for a host, nor its length', () => {
    expect(workers.withErrand).toBeUndefined();
    expect(workers.ERRAND_MS).toBeUndefined();
  });

  it('has no passage to the wall through the row of pieces', () => {
    expect(layout.PASSAGE).toBeUndefined();
  });
});
