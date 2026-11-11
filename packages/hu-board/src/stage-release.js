/**
 * KJC-TSK-1525 (decided by the maintainer on 2026-11-11): the release the "Ready to release"
 * table of kj stage counts from: the repo's newest tag and when it was made. Read only.
 */
import { execFileSync } from 'node:child_process';

/** `{ tag, at }` of the newest tag of `projectDir`, or null outside git or without tags. */
export function lastRelease(projectDir) {
  // A git hook's GIT_DIR & co would answer for another repo.
  const env = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[name];
  let out;
  try {
    out = execFileSync('git', ['-C', projectDir, 'for-each-ref', 'refs/tags', '--sort=-creatordate', '--count=1', '--format=%(refname:short)%09%(creatordate:iso-strict)'], {
      encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim();
  } catch {
    return null; // not a git repo, or git missing: the table counts every done card
  }
  const [tag, at] = out.split('\t');
  return tag && !Number.isNaN(Date.parse(at)) ? { tag, at: new Date(at).toISOString() } : null;
}
