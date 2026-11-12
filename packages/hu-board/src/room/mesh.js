/**
 * KJC-TSK-1571 (ADR 0056, point 3): the boards of a room open a WebRTC data channel to each other,
 * a full mesh. The smaller login offers; descriptions and candidates travel as strings through
 * `signals/<to>/<from>` of the room, and each signal is read once and deleted. `rtc` is the WebRTC
 * of the board (rtc-node.js) or a fake in the tests.
 */

/** Only one side of a pair offers: the smaller login. */
export const offers = (me, peer) => me < peer;

/** @param {{session: {login: string}, rtdb: object, rtc: {connect: Function}, onMessage: (from: string, message: object) => void, log?: Console}} deps */
export function createMesh({ session, rtdb, rtc, onMessage, log = console }) {
  const links = new Map(); // login -> { peer, channel }
  const seen = new Set();
  let present = new Set(); // who the presence says is in the room
  let inbox = {}; // the last tree of signals sent to this board
  const leaving = new AbortController();
  const signal = (to, message) => rtdb.push(`signals/${to}/${session.login}`, JSON.stringify(message))
    .catch((err) => log.warn(`[room] signal to ${to}: ${err.message}`));
  const wire = (from, link, channel) => {
    link.channel = channel;
    channel.onMessage((text) => {
      try { onMessage(from, JSON.parse(text)); } catch { log.warn(`[room] ${from} sent something that is not JSON`); }
    });
  };
  const linkTo = (login) => {
    const link = { channel: null, described: false, waiting: [] };
    link.peer = rtc.connect({
      onDescription: (sdp, type) => signal(login, { kind: 'description', sdp, type }),
      onCandidate: (candidate, mid) => signal(login, { kind: 'candidate', candidate, mid }),
      onChannel: (channel) => wire(login, link, channel),
    });
    links.set(login, link);
    if (offers(session.login, login)) wire(login, link, link.peer.openChannel('activity'));
    return link;
  };
  const drop = (login) => {
    links.get(login)?.peer.close();
    links.delete(login);
  };
  const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
  /** A signal of `from` on its link; an offer for a link already negotiated starts it again. */
  const play = (from, message) => {
    if (message.kind === 'description' && message.type === 'offer' && links.get(from)?.described) drop(from);
    const link = links.get(from) ?? linkTo(from);
    if (message.kind === 'description') {
      link.peer.setRemote(message.sdp, message.type);
      link.described = true;
      for (const c of link.waiting.splice(0)) link.peer.addCandidate(c.candidate, c.mid);
    } else if (message.kind === 'candidate') {
      if (link.described) link.peer.addCandidate(message.candidate, message.mid);
      else link.waiting.push(message);
    }
  };
  /**
   * Plays the new signals of each sender the presence says is in, then deletes them: only its
   * newest negotiation (what came before its last description is stale), and never a link the
   * board should offer itself. A sender not in yet keeps its signals waiting.
   */
  const stuck = new Map(); // played signals the room did not let this board delete yet
  const remove = (id, path) => rtdb.remove(path).then(() => stuck.delete(id), () => stuck.set(id, path));
  const onSignals = (tree) => {
    inbox = tree;
    for (const [id, path] of stuck) { stuck.delete(id); remove(id, path); }
    for (const [from, messages] of Object.entries(tree)) {
      if (!present.has(from)) continue;
      const fresh = Object.keys(messages ?? {}).filter((id) => !seen.has(id)).toSorted().map((id) => [id, parse(messages[id])]);
      const last = fresh.findLastIndex(([, m]) => m?.kind === 'description');
      fresh.forEach(([id, message], i) => {
        if (seen.has(id)) return; // a delete below may have played it already
        seen.add(id);
        remove(id, `signals/${session.login}/${from}/${id}`);
        if (message && i >= last && (links.has(from) || !offers(session.login, from))) play(from, message);
      });
    }
  };
  rtdb.listen(`signals/${session.login}`, onSignals, { signal: leaving.signal });
  return {
    /** Links to every live peer this board offers to, and drops the links of those who left. */
    setPeers(peers) {
      present = new Set(peers);
      for (const login of links.keys()) if (!present.has(login)) drop(login);
      for (const login of peers) if (!links.has(login) && offers(session.login, login)) linkTo(login);
      onSignals(inbox); // the signals of those just come in
    },
    /** Sends `message` to every peer whose channel is open. */
    send(message) {
      const text = JSON.stringify(message);
      for (const { channel } of links.values()) if (channel?.isOpen()) channel.send(text);
    },
    /** The peers with an open channel. */
    open: () => [...links].filter(([, link]) => link.channel?.isOpen()).map(([login]) => login),
    close() {
      leaving.abort();
      for (const login of links.keys()) drop(login);
    },
  };
}
