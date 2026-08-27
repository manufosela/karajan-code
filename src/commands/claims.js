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
import { readFileSync } from "node:fs";
import { readTurn } from "../claims/turn.js";
import { crossCheck, formatClaimReport } from "../claims/cross-check.js";

/**
 * `kj claims gate` — the same check, run by the Stop hook with the PROJECT's
 * say-so. The hook stays policy-free: kj reads `method_gates.claims` and
 * decides. "off" (default: adoption is explicit) exits 0 in silence; "warn"
 * reports and never blocks; "block" refuses only a datum DENIED by its own
 * source — unbacked data is reported either way, per the accepted ADR:
 * inform always, block almost never.
 */
export async function claimsGateCommand({ flags = {}, config = {}, logger = console, readTurnFn = readTurn, readFileFn = readFileSync } = {}) {
  const mode = config?.method_gates?.claims ?? "off";
  if (mode !== "warn" && mode !== "block") return 0;
  let turn;
  try {
    turn = readTurnFn(flags.transcript);
    // CLM-C: with --file the ARTIFACT is what gets checked — a PR body, a card, a
    // note — against the same turn's outputs. The final message is what outlives
    // the turn least; the artifact is what outlives it most.
    if (flags.file) turn = { ...turn, text: String(readFileFn(flags.file, "utf8")) };
  } catch {
    return 0; // not observable: a gate that cannot read its inputs gets out of the way
  }
  const result = crossCheck(turn);
  if (result.denied.length && mode === "block") {
    logger.error(formatClaimReport(result));
    return 2;
  }
  if (result.denied.length || result.unbacked.length) logger.error(formatClaimReport(result));
  return 0;
}

export async function claimsCommand({ flags = {}, logger = console, readTurnFn = readTurn, readFileFn = readFileSync } = {}) {
  const path = flags.transcript;
  if (!path) {
    logger.error("kj claims check: --transcript <path> is required");
    return 1;
  }
  let turn;
  try {
    turn = readTurnFn(path);
    if (flags.file) turn = { ...turn, text: String(readFileFn(flags.file, "utf8")) };
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
