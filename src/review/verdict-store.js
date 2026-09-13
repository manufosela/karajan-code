/**
 * Verdict store (ENV-B1, KJC-TSK-0637) — persists cross-AI review verdicts
 * keyed by the sha256 of the RAW diff they reviewed.
 *
 * The hash is the contract: a verdict only counts for byte-identical
 * content, so any change after the review voids it and forces a new one
 * (resolve-until-pass by construction). The pre-commit hook (ENV-C)
 * calls checkVerdict() with the staged diff to decide whether the
 * commit may enter. Diffs must be raw git output — never rtk-compressed
 * (KJC-BUG-0115).
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/process.js";

const STORE_DIR = path.join(".karajan", "reviews");

// KJC-BUG-0173: a verdict is keyed by one exact diff hash, so once that diff is
// committed or changed its hash is never looked up again — anything older than
// this TTL is dead weight and safe to shed. Nothing live stays staged for weeks.
export const VERDICT_TTL_DAYS = 14;

export function diffHash(diff) {
  // trimEnd: runners differ on the final newline (execa strips it, raw
  // git keeps it) — trailing whitespace must not void a verdict.
  return crypto.createHash("sha256").update(diff.trimEnd(), "utf8").digest("hex");
}

function verdictPath(projectDir, hash) {
  return path.join(projectDir, STORE_DIR, `${hash}.json`);
}

export async function saveVerdict(projectDir, diff, verdict) {
  const hash = diffHash(diff);
  const record = {
    ...verdict,
    diffHash: hash,
    timestamp: new Date().toISOString(),
  };
  const file = verdictPath(projectDir, hash);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  // KJC-BUG-0173: a review is the natural moment to shed dead verdicts.
  // Best-effort — hygiene must never break a save.
  try { await pruneVerdicts({ projectDir }); } catch { /* hygiene, not correctness */ }
  return record;
}

/**
 * Opportunistic GC for the verdict store: removes verdict files whose mtime is
 * older than `maxAgeDays`. A verdict only counts for a byte-identical diff, so
 * an aged one can never be re-checked. `now`/`dryRun` injectable for tests.
 * @returns {Promise<{scanned:number, removed:number, expired:string[], dryRun:boolean, maxAgeDays:number}>}
 */
export async function pruneVerdicts({ projectDir, maxAgeDays = VERDICT_TTL_DAYS, now = Date.now, dryRun = false } = {}) {
  const dir = path.join(projectDir || process.cwd(), STORE_DIR);
  const cutoff = now() - maxAgeDays * 86400000;
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return { scanned: 0, removed: 0, expired: [], dryRun, maxAgeDays };
  }
  const jsons = names.filter((n) => n.endsWith(".json"));
  const expired = [];
  for (const name of jsons) {
    try {
      const st = await fs.stat(path.join(dir, name));
      if (st.mtimeMs < cutoff) expired.push(name);
    } catch { /* vanished mid-scan */ }
  }
  let removed = 0;
  if (!dryRun) {
    for (const name of expired) {
      try { await fs.unlink(path.join(dir, name)); removed += 1; } catch { /* already gone */ }
    }
  }
  return { scanned: jsons.length, removed, expired, dryRun, maxAgeDays };
}

export async function loadVerdict(projectDir, hash) {
  try {
    return JSON.parse(await fs.readFile(verdictPath(projectDir, hash), "utf8"));
  } catch {
    return null;
  }
}

/**
 * ENV-F1 (KJC-TSK-0643): headless pipeline sessions call this after staging
 * and before committing. Their reviewer ALREADY cross-AI-reviewed the work,
 * so the verdict is recorded for the staged diff and the v4 pre-commit gate
 * accepts the pipeline's commit. No gate marker → no-op (zero overhead for
 * repos that never opted in). Raw git only — never a wrapped runner
 * (KJC-BUG-0115).
 * @returns {Promise<{stamped: boolean}>}
 */
export async function stampStagedVerdict({ projectDir, reviewer, summary = "", sonar = null }) {
  const dir = projectDir || process.cwd();
  try {
    await fs.access(path.join(dir, ".karajan", "review-gate"));
  } catch {
    return { stamped: false };
  }
  const res = await runCommand("git", ["diff", "--cached"], { cwd: dir });
  if (res.exitCode !== 0 || !res.stdout?.trim()) return { stamped: false };
  await saveVerdict(dir, res.stdout, {
    verdict: "approved", reviewer, host: "kj-pipeline", issues: [], summary,
    // KJC-TSK-0838: what the pipeline's sonar stage saw, so --check can tell
    // a run whose gate ran from one that skipped it.
    ...(sonar ? { sonar } : {}),
  });
  return { stamped: true };
}

/**
 * KJC-TSK-0838: the pipeline sonar stage result as a verdict sonar block.
 * SKIPPED (no remote, no key) or absent is `ran:false` WITH the reason — the
 * pre-commit check then refuses code, as it would for any other diff.
 * Coverage lists stay empty: the pipeline scans the whole project, and the
 * per-file proof (verbose index) is not wired into SonarRole yet.
 */
export function pipelineSonarBlock(stageResult) {
  if (!stageResult) return { ran: false, source: "pipeline", reason: "the pipeline recorded no sonar stage" };
  if (!stageResult.gateStatus || stageResult.gateStatus === "SKIPPED") {
    return { ran: false, source: "pipeline", reason: stageResult.reason || stageResult.error || "the sonar stage did not run" };
  }
  return {
    ran: true, source: "pipeline", projectKey: stageResult.projectKey || null, gateStatus: stageResult.gateStatus, covered: [], uncovered: [],
  };
}

/**
 * Is there an APPROVED verdict for exactly this diff?
 * @returns {Promise<{ok: boolean, verdict?: object, reason?: string}>}
 */
export async function checkVerdict(projectDir, diff) {
  const verdict = await loadVerdict(projectDir, diffHash(diff));
  if (!verdict) {
    return { ok: false, reason: "no verdict recorded for the current diff — run `kj review`" };
  }
  if (verdict.verdict !== "approved") {
    return { ok: false, verdict, reason: `review was rejected by ${verdict.reviewer} — fix the issues and run \`kj review\` again` };
  }
  return { ok: true, verdict };
}
