/**
 * KJC-TSK-1566 (ADR 0056, point 4): who may enter a repository's room. A board proves who it is
 * with its GitHub token: GitHub tells its login and its permission on the repository, and only
 * write, maintain or admin get in. The token is used for those two reads and never kept.
 * Pure: the HTTP client and the signer are injected (index.js passes fetch and Firebase Auth).
 */

const REPO = /^[\w.-]+\/[\w.-]+$/;
const WRITERS = new Set(['write', 'maintain', 'admin']);
const GITHUB = 'https://api.github.com';

/**
 * The board's GitHub token, from X-GitHub-Token. Not Authorization: Cloud Run checks a bearer
 * there as a Google identity and answers 401 itself before the function runs.
 */
export const githubTokenOf = (headers) => {
  const value = headers['x-github-token'];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/** A refusal the function answers with `status`. */
const refuse = (status, message) => Object.assign(new Error(message), { status });

/**
 * The room of `repo` as a Realtime Database key, one per repository: lower case (GitHub names
 * ignore case), the dot as a comma and the slash as a tilde, two characters a repository name
 * never holds, so no two repositories share a room.
 */
export const roomKey = (repo) => repo.toLowerCase().replaceAll('.', ',').replace('/', '~');

/**
 * @param {{repo: string, githubToken: string}} input
 * @param {{fetch: Function, sign: (uid: string, claims: object) => Promise<string>}} deps
 * @returns {Promise<{login: string, room: string, token: string}>} a Firebase token for that room only
 */
export async function admitToRoom(input, { fetch, sign }) {
  const { repo, githubToken } = input ?? {};
  if (typeof repo !== 'string' || !REPO.test(repo) || repo.includes('..')) throw refuse(400, 'repo must be owner/name');
  if (typeof githubToken !== 'string' || !githubToken) throw refuse(400, 'a GitHub token is needed');
  const ask = async (path) => {
    const res = await fetch(`${GITHUB}${path}`, { headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'karajan-room' } });
    if (res.status === 401) throw refuse(401, 'GitHub does not know this token');
    if (!res.ok) throw refuse(403, 'GitHub refused to tell the permission');
    return res.json();
  };
  const { login } = await ask('/user');
  if (typeof login !== 'string' || !login) throw refuse(401, 'GitHub gave no login for this token');
  const { permission } = await ask(`/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`);
  if (!WRITERS.has(permission)) throw refuse(403, `${login} may not write to ${repo}`);
  const room = roomKey(repo);
  return { login, room, token: await sign(`gh:${login}`, { room, login }) };
}
