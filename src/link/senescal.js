/**
 * HU-3800 (slice 7, ADR 0043 item 13): the Senescal convenes a ceremony and gathers what was said in it.
 * It decides nothing and grants nothing; what it reads is data, never an order.
 * Rejected: a Senescal that lives in the adapter (each adapter would re-implement the once-per-day rule,
 * the codec and the pre-post scan, and the reader's permission filter could be skipped). Here it is pure
 * orchestration over any adapter, so the guarantees hold unchanged for every one.
 */
import { CEREMONY_KINDS } from "./constants.js";
import { prepareToPost } from "./wrap.js";
import { readInbox } from "./reader.js";

const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

function agendaLine(agenda) {
  const items = (Array.isArray(agenda) ? agenda : [agenda]).map((item) => String(item ?? "").replace(UNSAFE, " ").trim()).filter(Boolean);
  if (items.length === 0) throw new TypeError("the agenda must name at least one item");
  return `Agenda: ${items.join("; ")}`;
}

/** `{ thread, opened }`: the open conversation of this kind and UTC day (adapter titles are `<kind>: <date> <title>`), or a new one with its first message posted. */
export async function convene(adapter, { kind, title, agenda, now = Date.now }) {
  if (!CEREMONY_KINDS.includes(kind)) throw new TypeError(`ceremony kind ${JSON.stringify(kind)} must be one of ${CEREMONY_KINDS.join(", ")}`);
  const conclusion = agendaLine(agenda);
  const today = now();
  const opening = (t) => ({ body: prepareToPost({ conclusion, block: { v: 1, type: "status", id: `convene-${today}`, reply_to: null, context: `#${t.number}`, to: "all", speaker: "agent" } }).text });
  opening({ number: 0 }); // refuse a private or oversized agenda BEFORE a conversation exists
  const existing = (await adapter.listConversations(kind)).find((c) => c.title?.startsWith(`${kind}: ${day(today)} `));
  if (existing) {
    // recovery: a conversation whose opening post failed is still empty, so it gets the opening message now
    if ((await adapter.listSince(existing, null)).messages.length === 0) await adapter.publish(existing, opening(existing));
    return { thread: existing, opened: false };
  }
  const thread = await adapter.openConversation(kind, title);
  await adapter.publish(thread, opening(thread));
  return { thread, opened: true };
}

/** `{ byAuthor: [{ author, contributions }], dropped, cursor, seen }`: permitted messages only, in order, `suspect` kept; bodies are never interpreted. */
export async function gather(adapter, thread, { record, now }) {
  const { messages, ...rest } = await readInbox({ adapter, thread, store: record, ...(now ? { now } : {}) });
  const groups = Map.groupBy(messages, (message) => message.author);
  return { byAuthor: [...groups].map(([author, contributions]) => ({ author, contributions })), ...rest };
}
