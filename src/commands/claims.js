/**
 * `kj claims check --transcript <path>` (CLM-B, KJC-TSK-0802) — checks the data
 * the AI states in a turn against what actually ran in that same turn.
 *
 * Deterministic and free: no model in the loop. Exit 2 only when a datum is
 * DENIED by its own source — a proven hallucination. Everything else is
 * reported, per the accepted ADR: inform always, block almost never.
 *
 * It fails OPEN. A verifier that cannot read the transcript says so and gets out
 * of the way: a broken check must never hold a session hostage.
 */
import { readTurn } from "../claims/turn.js";
import { crossCheck, formatClaimReport } from "../claims/cross-check.js";

export async function claimsCommand({ flags = {}, logger = console, readTurnFn = readTurn } = {}) {
  const path = flags.transcript;
  if (!path) {
    logger.error("kj claims check: --transcript <path> is required");
    return 1;
  }
  let turn;
  try {
    turn = readTurnFn(path);
  } catch (err) {
    // Not observable: the transcript could not be read. Never reported as clean.
    const note = `kj claims: transcript not readable (${err.message}) — nothing checked`;
    if (flags.json) logger.log(JSON.stringify({ ok: true, checked: false, reason: note }));
    else logger.error(note);
    return 0;
  }

  const result = crossCheck(turn);
  if (flags.json) {
    logger.log(JSON.stringify({ ok: true, checked: true, denied: result.denied, unbacked: result.unbacked, claims: result.claims.length }));
  } else if (result.denied.length || result.unbacked.length) {
    logger.error(formatClaimReport(result));
  } else {
    logger.log(`kj claims: ${result.claims.length} dato(s) comprobado(s), todos con respaldo en este turno`);
  }
  return result.denied.length ? 2 : 0;
}
