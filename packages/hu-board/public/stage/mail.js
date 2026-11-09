// KJC-TSK-1473: the human's mailbox of a factory. It holds the pending handoffs of
// each lane (the board's `mail`, stage-mail.js) and blinks while any is left.
// Pure, as courier.js: mailbox.js draws it.

export const BLINK_MS = 1000;

/** The mailbox of a factory from its lanes' state: lane → pending handoffs. */
export const mailboxOf = (lanes) => new Map(lanes.map(({ lane, mail }) => [lane ?? 'main', mail ?? 0]));

/** All the pending handoffs of the factory. */
export const mailTotal = (box) => [...box.values()].reduce((n, k) => n + k, 0);

/** The mailbox after `event`: a mail event sets its lane's count; anything else leaves it. */
export function withMail(box, event) {
  if (event?.type !== 'mail' || !Number.isInteger(event.pending) || event.pending < 0) return box;
  return new Map(box).set(event.lane ?? 'main', event.pending);
}

/** How lit the mailbox is at `now`, 0 to 1: dark without mail, blinking with it, steady when still. */
export function glowAt(pending, now, still) {
  if (!pending) return 0;
  if (still) return 1;
  return (1 + Math.cos((2 * Math.PI * now) / BLINK_MS)) / 2;
}
