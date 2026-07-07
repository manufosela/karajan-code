// KJC-TSK-0583 — Inbound secret redaction for the review boundary.
//
// The outbound boundary (output-guard.js) already blocks committing secrets.
// This closes the *inbound* gap: a hardcoded credential in the working tree
// would otherwise reach the (possibly cloud) reviewer model verbatim inside the
// diff. `redactSecrets` masks each credential before the model sees it, reusing
// the SAME catalog as output-guard — no new patterns, no AI cost, deterministic.
import { CREDENTIAL_PATTERNS } from "./output-guard.js";

// Families whose match begins with a fixed, identifiable literal prefix. The
// placeholder keeps that prefix so the reviewer can still tell WHAT kind of
// secret was redacted (and say "move it to .env") without seeing the value.
const STABLE_PREFIX_BY_ID = {
  "aws-key": "AKIA",
  "npm-token": "npm_",
  "openai-key": "sk-",
  "anthropic-key": "sk-ant-",
  "stripe-key": "sk_live_",
  "stripe-test": "sk_test_",
  "google-api-key": "AIza",
};

// Families with a dynamic prefix: keep the real match up to and including the
// first separator (ghp_/gho_/…, xoxb-/xoxp-/…), then mask the rest.
const DYNAMIC_SEPARATOR_BY_ID = {
  "github-token": "_",
  "slack-token": "-",
};

const GENERIC = "***REDACTED-SECRET***";
const SUFFIX = "***REDACTED***";

function placeholderFor(id, match) {
  const stable = STABLE_PREFIX_BY_ID[id];
  if (stable) return `${stable}${SUFFIX}`;
  const sep = DYNAMIC_SEPARATOR_BY_ID[id];
  if (sep) {
    const idx = match.indexOf(sep);
    return idx >= 0 ? `${match.slice(0, idx + 1)}${SUFFIX}` : GENERIC;
  }
  return GENERIC;
}

// Apply the most specific prefixes first so `sk-ant-` wins over `sk-`; families
// without a stable prefix keep their catalog order (stable sort) and run last.
function orderedPatterns() {
  return [...CREDENTIAL_PATTERNS].sort(
    (a, b) => (STABLE_PREFIX_BY_ID[b.id]?.length ?? 0) - (STABLE_PREFIX_BY_ID[a.id]?.length ?? 0)
  );
}

/**
 * Mask every credential in `text`, preserving line structure. Pure and
 * deterministic: clean text is returned untouched (no-op, no cost).
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const { id, pattern } of orderedPatterns()) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    out = out.replace(new RegExp(pattern.source, flags), (match) =>
      // Idempotent: a broad pattern (generic-secret, hardcoded-key-assignment)
      // can span an already-masked value; leave the more specific placeholder
      // in place instead of clobbering it with the generic one.
      match.includes("REDACTED") ? match : placeholderFor(id, match)
    );
  }
  return out;
}
