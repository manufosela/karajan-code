/**
 * KJC-TSK-1567 (ADR 0056): the board's presence in its repository's room. Every 30 s it writes
 * when it was last seen under its login (a number, as the rules ask); a peer is anyone else seen
 * in the last 90 s. Leaving takes the own presence away.
 */
const BEAT_MS = 30 * 1000;
const LIVE_MS = 90 * 1000;

/**
 * Everyone but `me` seen in the last 90 s at `now`, in order. The times are the server's (beat
 * writes its timestamp), so only this board's clock may be off: within 90 s either way passes.
 */
export const livePeers = (presence, me, now) =>
  Object.entries(presence ?? {})
    .filter(([login, at]) => login !== me && typeof at === 'number' && Math.abs(now - at) < LIVE_MS)
    .map(([login]) => login)
    .toSorted();

/**
 * Keeps `session`'s presence in its room through `rtdb` and calls `onPeers(logins)` when the live
 * peers change. Returns how to leave.
 */
export function keepPresence(session, rtdb, onPeers, { now = Date.now } = {}) {
  const leaving = new AbortController();
  let presence = {};
  let told = '';
  const tell = () => {
    const peers = livePeers(presence, session.login, now());
    if (peers.join() === told) return;
    told = peers.join();
    onPeers(peers);
  };
  // The server's own time, so no board's clock decides who is live.
  const beat = () => rtdb.put(`presence/${session.login}`, { '.sv': 'timestamp' }).catch((err) => console.warn(`[room] presence: ${err.message}`));
  beat();
  const timer = setInterval(() => { beat(); tell(); }, BEAT_MS);
  rtdb.listen('presence', (tree) => { presence = tree; tell(); }, { signal: leaving.signal });
  return async () => {
    clearInterval(timer);
    leaving.abort();
    await rtdb.remove(`presence/${session.login}`).catch(() => {});
  };
}
