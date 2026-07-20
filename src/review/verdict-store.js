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
  return record;
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
export async function stampStagedVerdict({ projectDir, reviewer, summary = "" }) {
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
  });
  return { stamped: true };
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
