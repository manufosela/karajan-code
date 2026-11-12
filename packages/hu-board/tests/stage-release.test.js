// KJC-TSK-1525 (decided by the maintainer on 2026-11-11): kj stage puts the cards done since the
// last release on a "Ready to release" table. The board reads the repo's newest tag, read only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { lastRelease } from '../src/stage-release.js';
import { laneStates } from '../src/stage-state.js';
import { newRelease, readyToRelease, releaseSign, versionLine } from '../public/stage/release.js';
import { acrossLanes } from '../public/stage/rest.js';

let proj;
const git = (...args) => execFileSync('git', ['-C', proj, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' });
beforeEach(() => { proj = mkdtempSync(join(tmpdir(), 'stage-release-')); });
afterEach(() => rmSync(proj, { recursive: true, force: true }));

describe('lastRelease', () => {
  it('is null outside git and in a repo without tags', () => {
    expect(lastRelease(proj)).toBeNull();
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'root');
    expect(lastRelease(proj)).toBeNull();
  });

  it('is the newest tag, with when it was made; the stage state of the main checkout carries it', () => {
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'root', '--date', '2026-11-01T10:00:00Z');
    git('tag', '-a', 'v1.0.0', '-m', 'one');
    git('commit', '-q', '--allow-empty', '-m', 'two');
    git('tag', '-a', 'v1.1.0', '-m', 'two');
    const release = lastRelease(proj);
    expect(release.tag).toMatch(/^v1\.[01]\.0$/);
    expect(Number.isNaN(Date.parse(release.at))).toBe(false);
    expect(laneStates(proj)[0].release).toEqual(release);
    expect(acrossLanes(laneStates(proj)).release).toEqual(release);
  });
});

describe('readyToRelease', () => {
  const card = (id, status, at) => ({ id, status, at, lane: 'main', title: null });
  const cards = [card('HU-1', 'done', '2026-11-10T10:00:00Z'), card('HU-2', 'done', '2026-11-08T10:00:00Z'), card('HU-3', 'running', '2026-11-10T11:00:00Z')];

  it('keeps the cards done after the release, newest first, or every done card without one', () => {
    expect(readyToRelease(cards, { tag: 'v1', at: '2026-11-09T00:00:00Z' }).map((c) => c.id)).toEqual(['HU-1']);
    expect(readyToRelease(cards, null).map((c) => c.id)).toEqual(['HU-1', 'HU-2']);
  });

  it('signs the table with how many and since which release (KJC-TSK-1526)', () => {
    expect(releaseSign(3, { tag: 'v5.16.0', at: 'x' })).toEqual(['Ready to release · 3', 'since v5.16.0']);
    expect(releaseSign(0, null)).toEqual(['Ready to release · 0', 'no release yet']);
  });
});

// KJC-TSK-1545 (asked by the maintainer on 2026-11-11): a counter shows the version, and a new
// release seen when the scene resyncs is the moment the pile goes and the counter changes.
describe('the version counter', () => {
  const v1 = { tag: 'v5.15.0', at: '2026-11-10T10:00:00Z' };
  const v2 = { tag: 'v5.16.0', at: '2026-11-12T10:00:00Z' };

  it('says the last release, or that there is none yet', () => {
    expect(versionLine(v2)).toBe('v5.16.0');
    expect(versionLine(null)).toBe('no release yet');
  });

  it('sees a new release only when the tag changes to another one', () => {
    expect(newRelease(v1, v2)).toBe(true);
    expect(newRelease(null, v1)).toBe(true);
    expect(newRelease(v1, { ...v1 })).toBe(false);
    expect(newRelease(v1, null)).toBe(false);
  });
});
