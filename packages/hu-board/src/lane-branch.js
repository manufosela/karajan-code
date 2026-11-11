/**
 * KJC-TSK-1539 (issue 3853): a lane's branch against its upstream, read from git without
 * network. An upstream with no ahead/behind count is gone, which after a fetch with prune
 * means the pull request was merged and its branch deleted.
 */
import { execFileSync } from 'node:child_process';

const line = (out, key) => out.split('\n').find((l) => l.startsWith(`# branch.${key} `))?.slice(`# branch.${key} `.length) ?? null;

/** The facts in `git status --porcelain=v2 --branch`, or null on a detached head. */
export function parseBranch(out) {
  const head = line(out, 'head');
  if (!head || head === '(detached)') return null;
  const upstream = line(out, 'upstream');
  const ab = line(out, 'ab');
  const ahead = Number(/^\+(\d+)/.exec(ab ?? '')?.[1] ?? 0);
  return { head, upstream, gone: Boolean(upstream) && ab === null, ahead };
}

/**
 * The branch facts of the lane at `dir`, or null when git cannot read them. Without optional
 * locks, so the board never takes the index of a lane where an agent is committing.
 */
export function branchFacts(dir) {
  try {
    return parseBranch(execFileSync('git', ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v2', '--branch', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }));
  } catch {
    return null;
  }
}
