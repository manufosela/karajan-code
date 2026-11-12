/**
 * KJC-TSK-1567 (ADR 0056, points 3 and 4): the board joins the room of a repository. It reads
 * owner/name from the project's origin, proves who it is to roomJoin with the gh token (sent once,
 * never kept), exchanges the Firebase token it gets for an id token, and keeps that fresh. The web
 * config is public and read from Firebase Hosting, so no key lives in the code.
 */
import { runCommand } from 'karajan-core/process';

export const ROOM_JOIN = 'https://europe-west1-karajan-code.cloudfunctions.net/roomJoin';
export const ROOM_DB = 'https://karajan-code-default-rtdb.europe-west1.firebasedatabase.app';
const WEB_CONFIG = 'https://karajancode.com/__/firebase/init.json';
const SIGN_IN = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken';
const REFRESH = 'https://securetoken.googleapis.com/v1/token';
/** An id token is renewed this long before it expires. */
const EARLY_MS = 5 * 60 * 1000;

/** owner/name of a GitHub remote (https or ssh); nothing for any other host. */
export function repoFromRemote(remote) {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/.exec(remote ?? '');
  return match ? `${match[1]}/${match[2]}` : null;
}

const post = async (fetch, url, body, headers = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return res.ok ? res.json() : null;
};

/**
 * Opens a session in the room of the repository at `dir`, or nothing when it has no GitHub origin,
 * gh gives no token or the room refuses it.
 * @returns {Promise<{login: string, room: string, repo: string, idToken: () => Promise<string>}|null>}
 */
export async function openSession(dir, { fetch = globalThis.fetch, run = runCommand, now = Date.now } = {}) {
  const remote = await run('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 5000 });
  const repo = remote.exitCode === 0 ? repoFromRemote(remote.stdout) : null;
  if (!repo) return null;
  const gh = await run('gh', ['auth', 'token'], { timeout: 5000 });
  if (gh.exitCode !== 0 || !gh.stdout.trim()) return null;
  const admitted = await post(fetch, ROOM_JOIN, { repo }, { 'X-GitHub-Token': gh.stdout.trim() });
  if (!admitted?.token) return null;
  const { apiKey } = await (await fetch(WEB_CONFIG)).json();
  const signed = await post(fetch, `${SIGN_IN}?key=${apiKey}`, { token: admitted.token, returnSecureToken: true });
  if (!signed?.idToken) return null;
  let current = { id: signed.idToken, refresh: signed.refreshToken, until: now() + Number(signed.expiresIn) * 1000 };
  const idToken = async () => {
    if (now() < current.until - EARLY_MS) return current.id;
    const res = await fetch(`${REFRESH}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refresh }).toString(),
    });
    if (!res.ok) throw new Error(`the room's token could not be renewed (HTTP ${res.status})`);
    const fresh = await res.json();
    current = { id: fresh.id_token, refresh: fresh.refresh_token, until: now() + Number(fresh.expires_in) * 1000 };
    return current.id;
  };
  return { login: admitted.login, room: admitted.room, repo, idToken };
}
