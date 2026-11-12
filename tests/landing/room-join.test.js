// KJC-TSK-1566 (ADR 0056, point 4): a board joins its repository's room by proving, with its
// GitHub token, that its account may write to the repository; the token is never kept.
import { describe, expect, it } from 'vitest';

import { admitToRoom, roomKey } from '../../apps/landing/functions/room.js';

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

/** A fake GitHub API: `login` for the token 'good', and `permission` for that login on the repository. */
function github({ login = 'jorgecasar', permission = 'write', seen = [] } = {}) {
  return async (url, { headers }) => {
    seen.push([url, headers.Authorization]);
    if (headers.Authorization !== 'Bearer good') return reply(401, { message: 'Bad credentials' });
    if (url === 'https://api.github.com/user') return reply(200, { login });
    if (url === `https://api.github.com/repos/manufosela/karajan-code/collaborators/${login}/permission`) return reply(200, { permission });
    return reply(404, {});
  };
}
const sign = async (uid, claims) => `signed:${uid}:${JSON.stringify(claims)}`;

describe('roomKey', () => {
  it('is the repository in lower case, safe as a Realtime Database key', () => {
    expect(roomKey('Manufosela/karajan-code')).toBe('manufosela~karajan-code');
    expect(roomKey('a.b/c.d')).toBe('a,b~c,d');
  });

  it('never gives two repositories the same room', () => {
    const repos = ['acme/one.two', 'acme/one_two', 'acme/one-two', 'acme.one/two', 'acme_one/two', 'acme/one__two'];
    expect(new Set(repos.map(roomKey)).size).toBe(repos.length);
  });
});

describe('admitToRoom', () => {
  it('admits an account that may write, signing its room and login', async () => {
    const seen = [];
    const out = await admitToRoom({ repo: 'manufosela/karajan-code', githubToken: 'good' }, { fetch: github({ seen }), sign });
    const room = 'manufosela~karajan-code';
    expect(out).toEqual({ login: 'jorgecasar', room, token: await sign('gh:jorgecasar', { room, login: 'jorgecasar' }) });
    expect(seen.map(([url]) => url)).toEqual(['https://api.github.com/user', 'https://api.github.com/repos/manufosela/karajan-code/collaborators/jorgecasar/permission']);
  });

  it('admits maintain and admin too', async () => {
    for (const permission of ['maintain', 'admin']) {
      await expect(admitToRoom({ repo: 'manufosela/karajan-code', githubToken: 'good' }, { fetch: github({ permission }), sign })).resolves.toHaveProperty('login');
    }
  });

  it('refuses an account that may only read, with 403', async () => {
    await expect(admitToRoom({ repo: 'manufosela/karajan-code', githubToken: 'good' }, { fetch: github({ permission: 'read' }), sign }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('refuses a token GitHub does not know, with 401', async () => {
    await expect(admitToRoom({ repo: 'manufosela/karajan-code', githubToken: 'bad' }, { fetch: github(), sign }))
      .rejects.toMatchObject({ status: 401 });
  });

  it('refuses a malformed repository or a missing token, with 400, before asking GitHub', async () => {
    const seen = [];
    for (const input of [{ repo: '../x', githubToken: 'good' }, { repo: 'a/b/c', githubToken: 'good' }, { repo: 'a/b' }, null]) {
      await expect(admitToRoom(input, { fetch: github({ seen }), sign })).rejects.toMatchObject({ status: 400 });
    }
    expect(seen).toEqual([]);
  });
});
