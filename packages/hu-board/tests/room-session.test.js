// KJC-TSK-1567 (ADR 0056, points 3 and 4): the board joins its repository's room. It reads the
// repository from origin, proves itself with the gh token to roomJoin, exchanges the Firebase
// token it gets for an id token and keeps that fresh. Every call is injected; nothing real here.
import { describe, expect, it } from 'vitest';

import { openSession, repoFromRemote } from '../src/room/session.js';

describe('repoFromRemote', () => {
  it('reads owner/name from an https or ssh GitHub remote', () => {
    expect(repoFromRemote('https://github.com/manufosela/karajan-code.git')).toBe('manufosela/karajan-code');
    expect(repoFromRemote('git@github.com:jorgecasar/karajan-code.git\n')).toBe('jorgecasar/karajan-code');
    expect(repoFromRemote('https://github.com/a/b')).toBe('a/b');
  });

  it('reads it through an SSH host alias of github.com (KJC-TSK-1578)', () => {
    expect(repoFromRemote('git@github.com-manufosela:manufosela/karajan-code.git\n')).toBe('manufosela/karajan-code');
  });

  it('is nothing for a remote that is not GitHub', () => {
    expect(repoFromRemote('https://gitlab.com/a/b.git')).toBeNull();
    expect(repoFromRemote('https://github.company.com/a/b.git')).toBeNull();
    expect(repoFromRemote('https://notgithub.com/a/b.git')).toBeNull();
    expect(repoFromRemote('')).toBeNull();
  });
});

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

/** A fake network: roomJoin, the web config, sign-in and refresh, each counted. */
function network({ joinStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (url.endsWith('/roomJoin')) return joinStatus === 200 ? json(200, { login: 'manufosela', room: 'manufosela~karajan-code', token: 'custom' }) : json(joinStatus, { error: 'no' });
    if (url.endsWith('/__/firebase/init.json')) return json(200, { apiKey: 'web-key' });
    if (url.includes('signInWithCustomToken')) return json(200, { idToken: 'id-1', refreshToken: 'r-1', expiresIn: '3600' });
    if (url.includes('securetoken')) return json(200, { id_token: 'id-2', refresh_token: 'r-2', expires_in: '3600' });
    return json(404, {});
  };
  return { fetch, calls };
}
const run = async (cmd, args) => ({ exitCode: 0, stdout: cmd === 'git' ? 'https://github.com/manufosela/karajan-code.git' : `gh-token-${args.join('-')}` });

describe('openSession', () => {
  it('joins the room of the repository with the gh token in X-GitHub-Token and signs in', async () => {
    const { fetch, calls } = network();
    const session = await openSession('/w/kc', { fetch, run, now: () => 0 });
    expect(session).toMatchObject({ login: 'manufosela', room: 'manufosela~karajan-code', repo: 'manufosela/karajan-code' });
    const join = calls.find((c) => c.url.endsWith('/roomJoin'));
    expect(join.init.headers['X-GitHub-Token']).toBe('gh-token-auth-token');
    expect(JSON.parse(join.init.body)).toEqual({ repo: 'manufosela/karajan-code' });
    expect(calls.some((c) => c.url.includes('signInWithCustomToken?key=web-key'))).toBe(true);
    expect(await session.idToken()).toBe('id-1');
  });

  it('refreshes the id token a while before it expires, and only then', async () => {
    const { fetch, calls } = network();
    let t = 0;
    const session = await openSession('/w/kc', { fetch, run, now: () => t });
    t = 50 * 60 * 1000;
    expect(await session.idToken()).toBe('id-1');
    t = 56 * 60 * 1000;
    expect(await session.idToken()).toBe('id-2');
    expect(calls.filter((c) => c.url.includes('securetoken'))).toHaveLength(1);
  });

  it('is nothing for a repository that is not on GitHub, without a gh token or refused, and says why (KJC-TSK-1578)', async () => {
    const said = [];
    const log = { warn: (m) => said.push(m) };
    const gitlab = async (cmd) => ({ exitCode: 0, stdout: cmd === 'git' ? 'https://gitlab.com/a/b.git' : 'tok' });
    const noGh = async (cmd) => (cmd === 'git' ? run(cmd, []) : { exitCode: 1, stdout: '' });
    expect(await openSession('/w/x', { fetch: network().fetch, run: gitlab, now: () => 0, log })).toBeNull();
    expect(await openSession('/w/kc', { fetch: network().fetch, run: noGh, now: () => 0, log })).toBeNull();
    expect(await openSession('/w/kc', { fetch: network({ joinStatus: 403 }).fetch, run, now: () => 0, log })).toBeNull();
    expect(said).toEqual([
      '[room] /w/x: its origin is not a GitHub repository',
      '[room] /w/kc: gh gives no token',
      '[room] /w/kc: the room of manufosela/karajan-code refused it (HTTP 403)',
    ]);
  });
});
