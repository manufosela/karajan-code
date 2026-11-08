/**
 * KJC-TSK-0849 (ADR 0010, RAG-C) — the session's RAG ledger as the review
 * sees it. The Sentinel records every RAG consultation per host session
 * (RAG-A) in `.karajan/harness/sentinel-state.json`. `kj review` runs as a
 * CLI and does not know the host's session id. In a LANE (a linked worktree)
 * one lane is one card, and `kj code` runs its coder as further sessions in
 * it, so the ledger is the lane's: queries and hits of every session of the
 * lane are joined. In the MAIN tree the state accumulates sessions of many
 * days and tasks, and joining them would let a new session ride on queries
 * made long ago, so it keeps the most recent session (`at`) alone.
 * `sessions` says how many were read, `sessionId` is the most recent one.
 * Said here and in the verdict, never assumed in silence.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { readLaneSentinelState } from "../harden/sentinel-lane-state.js";
import { resolveSentinelRoot, verifySentinelScripts } from "../harden/sentinel-hooks.js";

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
  // KJC-BUG-0223: el harness vive en la RAIZ del proyecto. Este modulo miraba
  // el directorio recibido (en la practica, process.cwd()) mientras el
  // verificador resolvia el toplevel de git, asi que desde un subdirectorio los
  // dos juzgaban sobre arboles distintos y el gate bloqueaba siempre.
  const root = resolveSentinelRoot(projectDir);
  const harnessDir = path.join(root, ".karajan", "harness");
  const harness = existsSync(harnessDir);
  const check = harness ? verifySentinelScripts({ projectDir: root }) : { ok: false, mismatched: [] };
  // KJC-BUG-0222: `drift` viaja hasta el mensaje. Un guard sellado que se ha
  // quedado atras NO lo arregla `kj harden` (lo deja en paz a proposito), asi
  // que mandar ese comando para ese fichero es un bucle.
  const base = { root, harness, verified: harness && check.ok === true, mismatched: check.mismatched || [], drift: check.drift || [], queries: [], hits: [] };
  // HU-3474: in a lane the state may live in the main tree; only this lane's sessions count.
  const state = readLaneSentinelState(root);
  if (!state) {
    return { ...base, available: false, reason: harness ? "no session activity recorded by the Sentinel yet" : "no Sentinel harness in this tree (kj harden installs it)" };
  }
  const sessions = Object.entries(state?.sessions || {});
  if (sessions.length === 0) {
    return { ...base, available: false, reason: "the sentinel state holds no session" };
  }
  sessions.sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0));
  const read = isLane(root) ? sessions : sessions.slice(0, 1);
  return { ...base, available: true, sessionId: sessions[0][0], sessions: read.length, ...joinSessions(read.map(([, s]) => s)) };
}

/** A linked worktree: `git rev-parse --git-dir` differs from `--git-common-dir`. */
function isLane(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const [gitDir, common] = out.trim().split("\n");
    return Boolean(gitDir) && Boolean(common) && gitDir !== common;
  } catch { return false; }
}

/** Joins the queries (sorted by `ts`) and the deduplicated hits of every session. */
function joinSessions(list) {
  const queries = list.flatMap((s) => (Array.isArray(s?.rag_queries) ? s.rag_queries : []));
  queries.sort((a, b) => (a?.ts || 0) - (b?.ts || 0));
  const hits = [...new Set(list.flatMap((s) => (Array.isArray(s?.rag_hits) ? s.rag_hits : [])))];
  return { queries, hits };
}
