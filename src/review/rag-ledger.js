/**
 * KJC-TSK-0849 (ADR 0010, RAG-C) — the session's RAG ledger as the review
 * sees it. The Sentinel records every RAG consultation per host session
 * (RAG-A) in `.karajan/harness/sentinel-state.json`. `kj review` runs as a
 * CLI and does not know the host's session id, so it takes the session with
 * the most recent activity (`at`): MONO-0 forbids two sessions mutating one
 * tree, so the last one that acted is the one now reviewing. Said here and
 * in the verdict (`sessionId`), never assumed in silence.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifySentinelScripts } from "../harden/sentinel-hooks.js";

/**
 * @param {string} projectDir
 * @returns {{harness: boolean, verified: boolean, mismatched: string[], available: boolean, reason?: string, sessionId?: string, queries: object[], hits: string[]}}
 *   `harness` false = no `.karajan/harness` in this tree: no host session can
 *   keep a ledger, so the requirement does not apply (said, not assumed).
 *   `verified` = the scripts on disk are byte-identical to what the INSTALLED
 *   kj writes (the tamper check's root of trust): an empty directory, an
 *   edited hook or one that predates the ledger all read as unverified, and
 *   the requirement fails closed until the human re-runs `kj harden`.
 */
export function readRagLedger(projectDir) {
  const harnessDir = path.join(projectDir, ".karajan", "harness");
  const harness = existsSync(harnessDir);
  const check = harness ? verifySentinelScripts({ projectDir }) : { ok: false, mismatched: [] };
  const base = { harness, verified: harness && check.ok === true, mismatched: check.mismatched || [], queries: [], hits: [] };
  let state;
  try {
    state = JSON.parse(readFileSync(path.join(harnessDir, "sentinel-state.json"), "utf8"));
  } catch {
    return { ...base, available: false, reason: harness ? "no session activity recorded by the Sentinel yet" : "no Sentinel harness in this tree (kj harden installs it)" };
  }
  const sessions = Object.entries(state?.sessions || {});
  if (sessions.length === 0) {
    return { ...base, available: false, reason: "the sentinel state holds no session" };
  }
  const [sessionId, s] = sessions.sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))[0];
  return { ...base, available: true, sessionId, queries: Array.isArray(s?.rag_queries) ? s.rag_queries : [], hits: Array.isArray(s?.rag_hits) ? s.rag_hits : [] };
}
