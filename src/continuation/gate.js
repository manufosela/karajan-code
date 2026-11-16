// KJC-TSK-1651 (ADR 0059): the turn does not end while the board holds work the agent can do.
// The work is the session's own: the cards it created or started (decision of the maintainer,
// 16-nov), followed through what kj printed in the session's transcript, with no network.
const CARD_LINE = /HU created: (HU-\d+) \((\w+)\)|✓ (HU-\d+) → (\w+)/g;
const STARTED = /Command running in background with ID: (\w+)/g;
const NOTIFIED = /<task-id>(\w+)<\/task-id>/g;
const STATED_STOP = /^\s*(Me paro por|Stopping because)\b/im;
const OPEN = new Set(["pending", "running"]);

/** Each card the session created or moved, with the last status kj printed for it, in order. */
export function sessionCards(texts) {
  const status = new Map();
  for (const { kind, text } of texts) {
    if (kind !== "output") continue;
    for (const m of text.matchAll(CARD_LINE)) status.set(m[1] ?? m[3], m[2] ?? m[4]);
  }
  return status;
}

/**
 * KJC-BUG-0622 (#4478): the board has the last word over the transcript. A card it knows takes its
 * status there; one someone else holds is not this session's work. `me` unknown: nothing is dropped.
 */
export function settleWithBoard(cards, board, me) {
  const settled = new Map();
  for (const [id, status] of cards) {
    const card = board.get(id);
    if (me && card?.claimed_by && card.claimed_by !== me) continue;
    settled.set(id, card?.status ?? status);
  }
  return settled;
}

/** The background tasks the session started whose completion notice has not come yet. */
export function runningBackground(texts) {
  const started = [];
  const notified = new Set();
  for (const { kind, text } of texts) {
    if (kind === "output") for (const m of text.matchAll(STARTED)) started.push(m[1]);
    if (kind === "user") for (const m of text.matchAll(NOTIFIED)) notified.add(m[1]);
  }
  return started.filter((id) => !notified.has(id));
}

const closesWithQuestion = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean).slice(-3).some((l) => l.endsWith("?"));

/**
 * `{ hold: false }`, or `{ hold: true, next, reason }` when the session's cards wait and the final
 * message does not name a stop kj can check: an open handoff, a closing question, a running task.
 */
export function judgeStop({ text, cards, handoffsOpen, background }) {
  const open = [...cards].filter(([, status]) => OPEN.has(status)).map(([id]) => id);
  if (open.length === 0) return { hold: false };
  const stated = STATED_STOP.test(text);
  if (stated && (handoffsOpen || closesWithQuestion(text) || background.length > 0)) return { hold: false };
  const next = open[0];
  const why = stated
    ? "el motivo que das no es uno que kj pueda comprobar"
    : "el mensaje final no dice por qué te paras";
  return {
    hold: true,
    next,
    reason: `quedan cards de esta sesión sin terminar (${open.join(", ")}) y ${why}. Sigue con ${next}. `
      + "Solo puedes parar con «Me paro por <motivo>» si esperas un encargo humano (kj handoff), "
      + "una respuesta del usuario (pregunta al final del mensaje) o una tarea en segundo plano; "
      + "una card que no puedes hacer se mueve a failed o skipped.",
  };
}
