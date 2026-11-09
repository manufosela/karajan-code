// KJC-TSK-1473: the human's mailbox on the map. It blinks while a lane of its
// factory holds a pending handoff, and goes dark when none is left.
import { describe, expect, it } from 'vitest';

import { BLINK_MS, glowAt, mailboxOf, mailTotal, withMail } from '../public/stage/mail.js';

describe('the mailbox of a factory', () => {
  it('starts from the mail of each lane; a lane without it has none', () => {
    const box = mailboxOf([{ lane: 'main', mail: 2 }, { lane: 'kj-stage', mail: 1 }, { lane: 'old' }]);
    expect(mailTotal(box)).toBe(3);
  });

  it('a mail event sets its lane count and leaves the rest', () => {
    const box = mailboxOf([{ lane: 'main', mail: 2 }, { lane: 'kj-stage', mail: 1 }]);
    const after = withMail(box, { type: 'mail', lane: 'kj-stage', pending: 0 });
    expect(mailTotal(after)).toBe(2);
    expect(mailTotal(box)).toBe(3);
    expect(mailTotal(withMail(after, { type: 'mail', pending: 4 }))).toBe(4);
  });

  it('any other event, or a count that is not a whole number, leaves it as it was', () => {
    const box = mailboxOf([{ lane: 'main', mail: 1 }]);
    expect(withMail(box, { type: 'card', lane: 'main' })).toBe(box);
    expect(withMail(box, { type: 'mail', lane: 'main', pending: -1 })).toBe(box);
    expect(withMail(box, { type: 'mail', lane: 'main', pending: 'x' })).toBe(box);
  });
});

describe('glowAt', () => {
  it('is dark without mail', () => {
    expect(glowAt(0, 123, false)).toBe(0);
  });

  it('blinks with mail: full at the start of each beat, dark half a beat later', () => {
    expect(glowAt(1, 0, false)).toBeCloseTo(1);
    expect(glowAt(1, BLINK_MS / 2, false)).toBeCloseTo(0);
    expect(glowAt(1, BLINK_MS, false)).toBeCloseTo(1);
  });

  it('stays lit, without blinking, for someone who asked for no motion', () => {
    expect(glowAt(2, BLINK_MS / 2, true)).toBe(1);
  });
});
