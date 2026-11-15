// KJC-TSK-1638 (asked by the maintainer on 2026-11-15): "why does the mailbox blink if I see nothing
// to do? Can a tooltip say what I have to do?". What the mailbox says of its letters (mail.js
// allLetters: { id, lane, kind, why, command, since }): a tooltip with the oldest, and every one for
// its list (mail-panel.js). Pure.

/** How many letters the tooltip names before it sends to the list. */
export const TIP_LETTERS = 3;

const UNITS = [[86_400_000, 'd'], [3_600_000, 'h'], [60_000, 'min']];

/** How long ago `since` (ISO) was at `now` (ms), in its largest whole unit; '' without it. */
export function ago(since, now) {
  const at = Date.parse(since ?? '');
  if (Number.isNaN(at)) return '';
  const waited = Math.max(0, now - at);
  const unit = UNITS.find(([ms]) => waited >= ms);
  return unit ? `${Math.floor(waited / unit[0])} ${unit[1]} ago` : 'just now';
}

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The tooltip's lines over the mailbox. */
export function mailTip(letters, now) {
  if (!letters.length) return ['Mailbox', 'Nothing waits for you.'];
  const named = letters.slice(0, TIP_LETTERS).map((l) => [l.lane, l.why ?? l.command ?? 'A handoff', ago(l.since, now)].filter(Boolean).join(' · '));
  const more = letters.length - named.length;
  const click = more ? `…and ${more} more. Click to see them all` : 'Click to see them all';
  return [`Mailbox · ${plural(letters.length, 'thing')} only you can do`, ...named, click];
}

/** Every letter as a row of the list: its lane, what to do, the command to type and since when. */
export const mailRows = (letters, now) => letters.map((l) => ({
  id: l.id,
  lane: l.lane,
  what: l.why ?? (l.command ? 'Run this command' : 'A handoff'),
  command: l.command ?? null,
  since: ago(l.since, now),
  denial: l.kind === 'denial',
}));
