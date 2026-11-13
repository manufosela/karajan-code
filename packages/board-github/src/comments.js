// HU-4138: what publish and listSince share between issue comments and Discussion comments.
const MAX_BODY = 60000;
export const checkBody = (message) => {
  if (typeof message?.body !== "string" || message.body.length < 1 || message.body.length > MAX_BODY) throw new TypeError(`message.body must be a string of 1 to ${MAX_BODY} characters`);
};
const encode = (c) => Buffer.from(JSON.stringify(c)).toString("base64url");
/** `null` (from the start) or the `{ since, ids }` a previous listSince issued; anything else throws. */
export const decodeCursor = (cursor) => {
  if (cursor === null) return null;
  try {
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (typeof c.since === "string" && Array.isArray(c.ids)) return c;
  } catch { /* falls through to the loud error */ }
  throw new TypeError("cursor was not issued by listSince");
};
/**
 * The messages newer than `seen` (an edit is a newer modifiedAt, so it shows up again), oldest first, and the cursor
 * past them: the latest modifiedAt plus the ids already given at that instant.
 */
export const pageSince = (rows, seen, cursor) => {
  const fresh = rows.filter((m) => !seen || m.modifiedAt > seen.since || (m.modifiedAt === seen.since && !seen.ids.includes(m.id)));
  if (fresh.length === 0) return { messages: [], cursor };
  const messages = fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const since = messages.reduce((m, x) => (x.modifiedAt > m ? x.modifiedAt : m), seen?.since ?? "");
  const ids = [...(seen?.since === since ? seen.ids : []), ...messages.filter((m) => m.modifiedAt === since).map((m) => m.id)];
  return { messages, cursor: encode({ since, ids }) };
};
