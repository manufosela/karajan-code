// KJC-TSK-1604 (the maintainer, 2026-11-13): roles are told apart by their shape, not by colours.
// Solomon, who arbitrates, is a robot of its own: King Solomon, in a long robe and a crown, built on
// the film's robot. The meshes are checked in the browser; here, who wears what.
import { describe, expect, it } from 'vitest';

import { COSTUMES, costumeOf } from '../public/stage/costume.js';

describe('costumeOf', () => {
  it('Solomon dresses as a king: a robe and a crown', () => {
    expect(costumeOf('solomon')).toBe('king');
    expect(COSTUMES.king).toEqual(['robe', 'crown']);
  });

  it('every other role keeps the film\'s robot', () => {
    for (const role of ['host', 'coder', 'reviewer', 'subagent', undefined]) expect(costumeOf(role)).toBeNull();
  });
});
