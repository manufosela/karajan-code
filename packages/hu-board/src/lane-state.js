/**
 * HU-3853 (stage lanes): what a lane is doing, derived from facts and never from
 * a robot. Pure: every fact is handed in, so nothing here reads a file, a
 * network or `gh`. A fact that is null or missing could not be read.
 *
 * Precedence: finished > waiting-merge > waiting-person > working > idle. A
 * state whose fact is unreadable stops the walk: the lane is `unknown`, never
 * `working`, because the unread fact may be the one that outranks it.
 * waiting-merge also needs no activity (an open pull request still worked on
 * is `working`).
 */

const isRead = (v) => v !== null && v !== undefined;
/** The test applied to a fact, or null when the fact could not be read. */
const when = (v, test) => (isRead(v) ? test(v) : null);
/**
 * `and` is strict: an unread fact makes it null even when another is false, so a lane never
 * reads as `working` past a fact nobody could check. `or` lets a known true decide.
 */
const and = (...xs) => (xs.includes(null) ? null : xs.every(Boolean));
const or = (...xs) => (xs.includes(true) ? true : xs.includes(null) ? null : false);

const cardsDone = (cards) => cards.length > 0 && cards.every(({ status }) => status === 'done');

export function deriveLaneState(facts = {}) {
  const { working, cards, mail, openPr, merged } = facts;
  const steps = [
    ['finished', or(when(cards, cardsDone), when(merged, Boolean)), 'its card is done or its branch is merged', ['cards', 'merged']],
    ['waiting-merge', and(when(openPr, Boolean), when(working, (w) => w.length === 0)), 'its branch has an open pull request and no activity', ['openPr', 'working']],
    ['waiting-person', when(mail, (m) => m > 0), 'a handoff is pending for the person', ['mail']],
    ['working', when(working, (w) => w.length > 0), 'an agent was active recently', ['working']],
  ];
  for (const [state, holds, stateReason, needs] of steps) {
    if (holds === true) return { state, stateReason };
    if (holds === null) {
      const unread = needs.filter((k) => !isRead(facts[k]));
      return { state: 'unknown', stateReason: `cannot read ${unread.join(', ')}` };
    }
  }
  return { state: 'idle', stateReason: 'no activity, nothing pending' };
}
