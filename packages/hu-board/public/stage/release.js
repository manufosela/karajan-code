// KJC-TSK-1525 (decided by the maintainer on 2026-11-11): the cards the "Ready to release"
// table piles up: done after the last release (every done one without a release), newest first.

/** KJC-TSK-1526: what the table's sign says: how many, and since which release. */
export const releaseSign = (count, release) => [`Ready to release · ${count}`, release ? `since ${release.tag}` : 'no release yet'];

/** KJC-TSK-1545: what the version counter beside the table says. */
export const versionLine = (release) => release?.tag ?? 'no release yet';

/** KJC-TSK-1545: whether `after` (the board's newest tag now) is a release the scene has not seen. */
export const newRelease = (before, after) => Boolean(after?.tag) && after.tag !== before?.tag;

/** The cards done since `release` (`{ tag, at }` or null), newest first. */
export const readyToRelease = (cards, release) => cards
  .filter((c) => c.status === 'done' && (!release || Date.parse(c.at) > Date.parse(release.at)))
  .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
