/**
 * KJC-TSK-1539 (issue 3853): a lane's branch against its upstream, read from git without
 * network. An upstream with no ahead/behind count is gone, which after a fetch with prune
 * means the pull request was merged and its branch deleted.
 */
import { execFileSync } from 'node:child_process';

const line = (out, key) => out.split('\n').find((l) => l.startsWith(`# branch.${key} `))?.slice(`# branch.${key} `.length) ?? null;

/**
 * The facts in `git status --porcelain=v2 --branch`. A detached head (a lane resting at its base
 * once its work is merged) answers `{ head: null, detached: true, oid }`; null is only for
 * output without a head.
 */
export function parseBranch(out) {
  const head = line(out, 'head');
  if (!head) return null;
  if (head === '(detached)') return { head: null, detached: true, oid: line(out, 'oid') };
  const upstream = line(out, 'upstream');
  const ab = line(out, 'ab');
  const ahead = Number(/^\+(\d+)/.exec(ab ?? '')?.[1] ?? 0);
  return { head, upstream, gone: Boolean(upstream) && ab === null, ahead };
}

/**
 * The branch facts of the lane at `dir`, or null when git cannot read them. Without optional
 * locks, so the board never takes the index of a lane where an agent is committing. Only a
 * detached head pays a second status, untracked files included, and the read of its base.
 */
export function branchFacts(dir) {
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
  try {
    const facts = parseBranch(git('status', '--porcelain=v2', '--branch', '--untracked-files=no'));
    if (!facts?.detached) return facts;
    const base = baseOf(git);
    return { ...facts, clean: isClean(git), base, atBase: atBase(git, facts.oid, base) };
  } catch {
    return null;
  }
}

/** Whether the lane holds no change at all, tracked or untracked (ignored files do not count). */
function isClean(git) {
  return git('status', '--porcelain', '--untracked-files=normal') === '';
}

/** The branch the repository's origin/HEAD names (`origin/trunk` gives `trunk`), read without network. */
function baseOf(git) {
  try {
    return git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD').trim().replace(/^origin\//, '');
  } catch (error) {
    // Fallback: `symbolic-ref --quiet` exits 1, silently, only when origin/HEAD is not set, and
    // only then is the base origin/main. Any other failure leaves the lane's branch unreadable.
    if (error.status === 1) return 'main';
    throw error;
  }
}

/** Whether `oid` is the commit of origin/<base>, read without network (false when it is not there). */
function atBase(git, oid, base) {
  try {
    return git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`).trim() === oid;
  } catch {
    return false;
  }
}
