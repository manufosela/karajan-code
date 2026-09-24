/**
 * Models the provider has retired, remembered (KJC-TSK-0827).
 *
 * KJC-TSK-0859 made a dead model recoverable: the chain moves on. What it does
 * not do is stop the SECOND run from paying for the same corpse, and the third,
 * and every one after, because the dead model is still what the config pins.
 * The field case: codex retired gpt-5.4 and gpt-5.4-mini on 2026-09-09 and the
 * reviewer kept calling a dead model on every single run.
 *
 * So kj remembers, per account (this is a global fact, not a project one), and
 * skips a model it has watched die. Two deliberate limits:
 *
 *  - kj NEVER edits the user's declaration. The pin is theirs; kj says which
 *    line to change and keeps working meanwhile. (The card asked for the
 *    config to be rewritten; that part is the user's call, and it is asked in
 *    the card rather than decided here.)
 *  - an entry expires. A wrong verdict must heal by itself, and a provider
 *    bringing a model back must not need a cache flush nobody would think of.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getKarajanHome } from "../utils/paths.js";

/** A month is long enough to stop paying for it, short enough to be wrong. */
export const DEAD_MODEL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const storePath = () => join(getKarajanHome(), "dead-models.json");
const keyOf = (provider, model) => `${provider}::${model}`;

function load() {
  const file = storePath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // A corrupt store is not a reason to fail a run: kj forgets and relearns.
    return {};
  }
}

/** @returns {boolean} true when the record was written. */
export function recordDeadModel({ provider, model, reason = null, now = Date.now() }) {
  if (!provider || !model) return false;
  const store = load();
  store[keyOf(provider, model)] = { provider, model, reason, at: new Date(now).toISOString(), expiresAt: now + DEAD_MODEL_TTL_MS };
  try {
    const file = storePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2));
    return true;
  } catch {
    // Remembering is an optimisation, never a gate: if the home is read-only
    // the run still works, it just pays the dead call again.
    return false;
  }
}

/** @returns {null|{provider: string, model: string, reason: string|null, at: string}} */
export function deadModelRecord(provider, model, now = Date.now()) {
  if (!provider || !model) return null;
  const hit = load()[keyOf(provider, model)];
  if (!hit) return null;
  if (!hit.expiresAt || hit.expiresAt <= now) return null; // expired: try it again
  return hit;
}

/** Live entries only, newest first — for `kj doctor` and friends. */
export function listDeadModels(now = Date.now()) {
  return Object.values(load())
    .filter((e) => e.expiresAt > now)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
