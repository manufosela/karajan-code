/**
 * "That model is gone" — one definition, two readers (KJC-TSK-0859).
 *
 * A dead model announced itself in two unrelated places: each agent matched
 * these patterns privately to retry with its provider default, and the brain's
 * error classifier had no idea the class existed, so it filed the failure as
 * UNKNOWN_FATAL and aborted the run. Same event, two verdicts.
 *
 * The patterns live here so the agent and the brain read the SAME definition,
 * and a model that a provider retired becomes a reason to move down the
 * declared chain instead of a reason to stop.
 */
export const MODEL_NOT_SUPPORTED_PATTERNS = [
  /model.{0,30}is not supported/i,
  /model.{0,30}not available/i,
  /model.{0,30}does not exist/i,
  /unsupported model/i,
  /invalid model/i,
  /model_not_found/i,
];

/** @param {string} text @returns {boolean} */
export function isModelUnavailableText(text) {
  if (!text) return false;
  return MODEL_NOT_SUPPORTED_PATTERNS.some((re) => re.test(text));
}

/** The matched sentence, for a message that names what died. */
export function pickModelUnavailableMessage(text) {
  for (const re of MODEL_NOT_SUPPORTED_PATTERNS) {
    const line = String(text).split("\n").find((l) => re.test(l));
    if (line) return line.trim();
  }
  return null;
}
