/**
 * KJC-TSK-1568 (ADR 0056, point 5): the room's relay, for a board that cannot open a channel with
 * a peer (a strict NAT, a corporate network; there is no TURN). Each board keeps its latest
 * messages, numbered, as one string under relay/<login> (the rules ask for a string under 20000
 * characters), written at most once a second; a peer plays each new one once, unless it already
 * hears that board directly.
 */
const KEEP = 30;
const EVERY_MS = 1000;
const LIMIT = 19000;

export function createRelay({ session, rtdb, onMessage, hearsDirectly, keep = KEEP, everyMs = EVERY_MS, signal, log = console }) {
  let kept = [];
  let seq = 0;
  let writing = null;
  const epoch = crypto.randomUUID(); // a board that starts again numbers from 1 under a new epoch
  const played = new Map(); // login -> { epoch, seq } last played
  const write = async () => {
    let text = JSON.stringify(kept);
    while (text.length > LIMIT && kept.length > 1) {
      kept = kept.slice(1);
      text = JSON.stringify(kept);
    }
    await rtdb.put(`relay/${session.login}`, text).catch((err) => log.warn(`[room] relay: ${err.message}`));
  };
  /** The entries of `from`'s relay not played yet, marked played; none for anything but a list. */
  const freshOf = (from, text) => {
    let list;
    try { list = JSON.parse(text); } catch { return []; }
    if (!Array.isArray(list)) return [];
    const theirs = list.at(-1)?.epoch;
    const before = played.get(from);
    const last = before?.epoch === theirs ? before.seq : 0;
    const fresh = list.filter((e) => e?.epoch === theirs && Number.isInteger(e.seq) && e.seq > last);
    if (fresh.length) played.set(from, { epoch: theirs, seq: Math.max(...fresh.map((e) => e.seq)) });
    return fresh;
  };
  rtdb.listen('relay', (tree) => {
    for (const [from, text] of Object.entries(tree)) {
      if (from === session.login) continue;
      const fresh = freshOf(from, text);
      if (!hearsDirectly(from)) for (const e of fresh) onMessage(from, e.message);
    }
  }, { signal });
  return {
    /** Adds `message` to the own relay; a burst is written once, at most once a second. */
    publish(message) {
      seq += 1;
      kept = [...kept, { epoch, seq, message }].slice(-keep);
      if (!everyMs) return write();
      writing ??= new Promise((r) => setTimeout(r, everyMs)).then(write).finally(() => { writing = null; });
      return writing;
    },
  };
}
