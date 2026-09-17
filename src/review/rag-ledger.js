/**
 * KJC-TSK-0849 (ADR 0010, RAG-C) — the session's RAG ledger as the review
 * sees it. The Sentinel records every RAG consultation per host session
 * (RAG-A) in `.karajan/harness/sentinel-state.json`. `kj review` runs as a
 * CLI and does not know the host's session id, so it takes the session with
 * the most recent activity (`at`): MONO-0 forbids two sessions mutating one
 * tree, so the last one that acted is the one now reviewing. Said here and
 * in the verdict (`sessionId`), never assumed in silence.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * @param {string} projectDir
 * @returns {{available: boolean, reason?: string, sessionId?: string, queries: object[], hits: string[]}}
 */
export function readRagLedger(projectDir) {
  let state;
  try {
    state = JSON.parse(readFileSync(path.join(projectDir, ".karajan", "harness", "sentinel-state.json"), "utf8"));
  } catch {
    return { available: false, reason: "no sentinel state in this tree (kj harden not run, or no session activity yet)", queries: [], hits: [] };
  }
  const sessions = Object.entries(state?.sessions || {});
  if (sessions.length === 0) {
    return { available: false, reason: "the sentinel state holds no session", queries: [], hits: [] };
  }
  const [sessionId, s] = sessions.sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))[0];
  return { available: true, sessionId, queries: Array.isArray(s?.rag_queries) ? s.rag_queries : [], hits: Array.isArray(s?.rag_hits) ? s.rag_hits : [] };
}
