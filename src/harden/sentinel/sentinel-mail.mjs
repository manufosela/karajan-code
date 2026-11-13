// HU-4210: the agent minds the link mail that waits for it. The board writes only the count to
// .karajan/link/unread.json; read here straight from the file, never through kj (no spawn, no
// network). Anything unreadable counts as nothing (fail open). Never a body, author or subject.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const MAIL_STALE_MS = 2 * 60 * 60 * 1000;
const REMIND_EVERY_MS = 30 * 60 * 1000;

/** The unread count the board noted for the lane at `top`; 0 when the file is missing, broken, stale or odd. */
export const unreadMail = (top, now = Date.now()) => {
  try {
    const { unread, at } = JSON.parse(readFileSync(join(top, ".karajan", "link", "unread.json"), "utf8"));
    return Number.isInteger(unread) && unread > 0 && typeof at === "number" && now - at <= MAIL_STALE_MS ? unread : 0;
  } catch { return 0; }
};

/** The reminder text for `count` waiting messages. */
export const mailText = (count) => "karajan sentinel: te esperan " + count + " mensaje(s) de kj link sin leer — léelos con kj link inbox.";

/** The mail reminder owed to the lane at `top`, or null; noted in `state.mail_reminded` so the next waits 30 min. */
export const takeMailReminder = (state, top, now) => {
  const count = unreadMail(top, now);
  const reminded = (state.mail_reminded ||= {});
  if (count === 0 || (typeof reminded[top] === "number" && now - reminded[top] < REMIND_EVERY_MS)) return null;
  reminded[top] = now;
  return mailText(count);
};
