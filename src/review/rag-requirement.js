/**
 * KJC-TSK-0849 (ADR 0010, RAG-C) — a diff that touches source files enters
 * the review only if the session's RAG ledger (RAG-A) shows the RAG answered
 * about every staged source: the file itself or a sibling of its directory.
 * A file NEW in the diff cannot have been returned yet: it counts as covered
 * once the session consulted at all (the ADR's fallback A, same as the
 * Sentinel gate). Docs-only diffs are exempt. The only other way through is
 * a live HUMAN grant on `method.rag.code` — never an env var: an escape the
 * agent can set for itself is the hole this closes.
 *
 * The block also names the TWINS: sources the RAG returned for the same
 * concepts that are not in the diff. That list travels to the reviewer,
 * because the bugs of 2026-09-16 were exactly the twin nobody touched.
 */
import { sourceFilesOf } from "./tests-with-code.js";

export const RAG_RULE_ID = "method.rag.code";

const GRANT_HINT = `Only a human grant lifts this: kj policy grant --rule ${RAG_RULE_ID} --until <iso> --reason "<why>"`;
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function liveGrant(standingExceptions, now) {
  return standingExceptions.find((e) => e.rule_id === RAG_RULE_ID && new Date(e.expiresAt).getTime() > now.getTime()) || null;
}

/**
 * @param {object} args
 * @param {string[]} args.stagedFiles - every path of the diff
 * @param {string[]} [args.newFiles] - paths ADDED by the diff (not in HEAD)
 * @param {{available: boolean, reason?: string, queries: object[], hits: string[]}} [args.ledger]
 * @returns {{ok: boolean, mode: "docs-only"|"pass"|"granted"|"block", reason?: string, grant?: object, sources?: string[], queries?: number, covered?: string[], uncovered?: string[], twinsUntouched?: string[]}}
 */
export function checkRagRequirement({ config = {}, stagedFiles = [], newFiles = [], ledger, standingExceptions = [], now = new Date(), env = {} }) {
  const { sources } = sourceFilesOf(config, stagedFiles);
  if (sources.length === 0) return { ok: true, mode: "docs-only" };

  const grant = liveGrant(standingExceptions, now);
  if (grant) return { ok: true, mode: "granted", grant, sources };

  // An env override is REJECTED here, explicitly: whatever KJ_ALLOW_* the
  // process carries is named in the reason and changes nothing. The Sentinel
  // escape opens an edit; it never opens the review.
  const ignored = Object.keys(env || {}).filter((k) => k.startsWith("KJ_ALLOW_") && env[k] === "1");
  const overrideNote = ignored.length > 0 ? ` (${ignored.join(", ")} is not honoured here)` : "";
  const head = `The RAG must have answered about code before it is reviewed (${sources.length} staged source${sources.length === 1 ? "" : "s"})${overrideNote}`;
  // KJC-BUG-0192: no Sentinel in this tree used to PASS, which made "do not
  // harden" the comfortable way around the gate. Nobody recording the session
  // is a reason to install the harness, or to ask for a grant, never a silent
  // exemption: the proof of the method cannot depend on the project choosing
  // to install whoever records it.
  if (ledger?.harness === false) {
    return { ok: false, mode: "block", sources, reason: `${head} — no Sentinel harness in this tree, so no session ledger can exist: install it with \`kj harden\`. ${GRANT_HINT}` };
  }
  // A harness that does not match the installed kj (edited, emptied, or older
  // than the ledger) cannot vouch for anything: fail closed, like the tamper
  // check does, until the human regenerates it.
  if (ledger?.harness === true && ledger?.verified === false) {
    return { ok: false, mode: "block", sources, reason: `${head} — the Sentinel harness does not match the installed kj (${(ledger.mismatched || []).join(", ") || "scripts missing"}): the human runs \`kj harden\` to regenerate it before code is reviewed. ${GRANT_HINT}` };
  }
  if (!ledger?.available) {
    return { ok: false, mode: "block", sources, reason: `${head} — ${ledger?.reason || "no session ledger"}: consult the RAG about the change (kj_rag_query / kj rag query) and run \`kj review --staged\` again. ${GRANT_HINT}` };
  }
  const hits = ledger.hits || [];
  const queries = (ledger.queries || []).length;
  const fresh = new Set(newFiles);
  const answered = (f) => hits.includes(f) || hits.some((h) => dirOf(h) === dirOf(f)) || (fresh.has(f) && queries > 0);
  const covered = sources.filter(answered);
  const uncovered = sources.filter((f) => !answered(f));
  const staged = new Set(stagedFiles);
  const twinsUntouched = hits.filter((h) => !staged.has(h));
  const evidence = { queries, covered, uncovered, twinsUntouched };
  if (uncovered.length > 0) {
    const list = `${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? "…" : ""}`;
    return { ok: false, mode: "block", sources, ...evidence, reason: `${head} — no query of this session returned ${uncovered.length} of them (${list}): ask what they do and where else that concept lives, then run \`kj review --staged\` again. ${GRANT_HINT}` };
  }
  return { ok: true, mode: "pass", sources, ...evidence };
}

/**
 * The pre-commit side (`kj review --check`): the verdict's `rag` block is the
 * evidence, recomputed against the CURRENT staged sources like the sonar
 * block — the diff hash pins the file set, so a source missing from
 * `covered` was never answered about, whatever the block claims.
 */
export function checkRagVerdict({ config = {}, stagedFiles = [], rag, harness = true, verified = true, mismatched = [], standingExceptions = [], now = new Date() }) {
  const { sources } = sourceFilesOf(config, stagedFiles);
  if (sources.length === 0) return { ok: true, mode: "docs-only" };
  const grant = liveGrant(standingExceptions, now);
  if (grant) return { ok: true, mode: "granted", grant, sources };
  const head = `The RAG must have answered about code before it is committed (${sources.length} staged source${sources.length === 1 ? "" : "s"})`;
  // KJC-BUG-0192: same rule on the --check side, so the commit gate cannot be
  // opened by removing the supervisor either.
  if (!harness) {
    return { ok: false, mode: "block", sources, reason: `${head} — no Sentinel harness in this tree, so no session ledger can exist: install it with \`kj harden\`. ${GRANT_HINT}` };
  }
  if (!verified) {
    return { ok: false, mode: "block", sources, reason: `${head} — the Sentinel harness does not match the installed kj (${mismatched.join(", ") || "scripts missing"}): the human runs \`kj harden\` to regenerate it. ${GRANT_HINT}` };
  }
  if (!rag) {
    return { ok: false, mode: "block", sources, reason: `${head} — the verdict carries no rag block; run \`kj review --staged\` again. ${GRANT_HINT}` };
  }
  // The block's mode is a claim, never an authorization: a grant or a missing
  // harness only count when they hold NOW (checked above). So the block can
  // only prove coverage — a "granted" or "no-harness" it recorded has lapsed.
  if (rag.mode !== "pass" || !Array.isArray(rag.covered)) {
    return { ok: false, mode: "block", sources, reason: `${head} — the verdict's rag block is malformed (mode ${JSON.stringify(rag.mode ?? null)}, covered ${Array.isArray(rag.covered) ? "list" : typeof rag.covered}); run \`kj review --staged\` again. ${GRANT_HINT}` };
  }
  const coveredSet = new Set(rag.covered);
  const uncovered = sources.filter((f) => !coveredSet.has(f));
  if (uncovered.length > 0) {
    const list = `${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? "…" : ""}`;
    return { ok: false, mode: "block", sources, reason: `${head} — the session ledger never covered ${uncovered.length} of them (${list}); consult the RAG and run \`kj review --staged\` again. ${GRANT_HINT}` };
  }
  return { ok: true, mode: "pass", sources };
}

/** The `rag` block stored in the verdict, bound to the diff hash like `sonar`. */
export function ragBlock(req, ledger) {
  return {
    mode: req.mode,
    sessionId: ledger?.sessionId || null,
    queries: req.queries ?? (ledger?.queries || []).length,
    covered: req.covered || [],
    uncovered: req.uncovered || [],
    twinsUntouched: req.twinsUntouched || [],
  };
}
