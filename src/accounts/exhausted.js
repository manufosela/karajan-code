/**
 * HU-4750 (ADR 0064 decision 4): which accounts are out of their limit, and until when. One small file
 * under the kj home, shared by every kj process, so a second lane does not spend a call to learn what
 * the first already knows. It holds ids and dates only, never in accounts.json (that is configuration).
 * A missing, empty or corrupt file means nothing is exhausted: a stale hold must never block a launch.
 */
import fs from "node:fs";
import path from "node:path";
import { getKarajanHome } from "../utils/paths.js";
import { parseCooldown } from "../utils/rate-limit-detector.js";

const DEFAULT_HOLD_MS = 60 * 60 * 1000;
const fileOf = (home) => path.join(home, "exhausted.json");

/** @returns {Record<string, string>} id to ISO time; {} for a missing, empty or unreadable file. */
function readAll(home) {
  try {
    const data = JSON.parse(fs.readFileSync(fileOf(home), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** The entries still in force at `now`, as Date values. */
const live = (all, now) => Object.entries(all).map(([id, iso]) => [id, new Date(iso)]).filter(([, until]) => until > now);

/** Record that the account is out until `until`; the entries that have passed are dropped on the way. */
export function markExhausted(id, until, { home = getKarajanHome(), now = new Date() } = {}) {
  const when = new Date(until);
  if (Number.isNaN(when.getTime()) || when <= now) throw new Error(`accounts: the until of "${id}" must be a future time, got "${until}"`);
  const entries = live(readAll(home), now).filter(([other]) => other !== id);
  const data = Object.fromEntries([...entries, [id, when]].map(([key, date]) => [key, date.toISOString()]));
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${fileOf(home)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, fileOf(home));
}

/** @returns {Date|null} when the account is back, or null when it is not exhausted. */
export function exhaustedUntil(id, { home = getKarajanHome(), now = new Date() } = {}) {
  return live(readAll(home), now).find(([other]) => other === id)?.[1] ?? null;
}

/**
 * Until when to hold an account after a limit message: the reset time the message carries, else the
 * account's own limit wait, else an hour.
 * @returns {Date}
 */
export function limitHold(message, pace, { now = new Date() } = {}) {
  const { cooldownUntil } = parseCooldown(message);
  if (cooldownUntil) return new Date(cooldownUntil);
  const wait = Number(pace?.limitWaitSeconds);
  return new Date(now.getTime() + (wait > 0 ? wait * 1000 : DEFAULT_HOLD_MS));
}
