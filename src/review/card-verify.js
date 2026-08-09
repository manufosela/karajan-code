/**
 * card-verify — KJC-TSK-0732 (issue #1371). With a declared tracker,
 * card-first upgrades "the branch names a card" to "the tracker says that
 * card is ALIVE". Transport-agnostic: `board.verify_cmd` is the USER'S
 * adapter (their CLI/MCP wrapper — credentials never enter kj) printing
 * {exists, live, status?} JSON on stdout. Unverifiable NEVER blocks: it
 * degrades to branch-ref level SAYING SO — a gate must not claim a check
 * it didn't make, in either direction. Definitive verdicts are cached
 * briefly; degradations never are, so recovery is immediate.
 */
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { extractFirstJson } from "../utils/json-extract.js";

const execAsync = promisify(exec);
export const VERIFY_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 10 * 60 * 1000;
// The ref lands inside a shell command (the user's adapter template), so it
// must be inert BY CONSTRUCTION — card-ref alphabet only, anchored (codex
// catch: same injection class as the tournament coder names).
const SAFE_REF_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

const defaultExec = async (cmd, { cwd }) =>
  execAsync(cmd, { cwd, timeout: VERIFY_TIMEOUT_MS, maxBuffer: 1024 * 1024 });

function cachePath(projectDir) {
  return path.join(projectDir, ".kj", "cache", "card-verify.json");
}

/** @returns {Promise<{level: "tracker"|"branch-ref", verified: boolean|null, status?: string|null, note?: string}>}
 *  verified: true = alive · false = definitively not · null = degraded. */
export async function verifyCardAlive({ ref, verifyCmd, projectDir = process.cwd(), deps = {} }) {
  const { execFn = defaultExec, now = Date.now } = deps;
  if (!verifyCmd) {
    return {
      level: "branch-ref", verified: null,
      note: "card-first checked the branch reference only — set board.verify_cmd to verify the card against your tracker",
    };
  }

  if (!SAFE_REF_RE.test(String(ref))) {
    return {
      level: "branch-ref", verified: null,
      note: `tracker verification skipped — ref "${String(ref).slice(0, 30)}" is outside the card-ref alphabet`,
    };
  }
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cachePath(projectDir), "utf8"));
  } catch { /* no cache yet */ }
  // Keyed by adapter AND ref (reviewer catch): a verdict from one
  // verify_cmd must never answer for a different one.
  const key = `${createHash("sha256").update(verifyCmd).digest("hex").slice(0, 12)}:${ref}`;
  const hit = cache[key];
  if (hit && now() - hit.at < CACHE_TTL_MS) return hit.result;

  const cmd = verifyCmd.includes("{ref}") ? verifyCmd.replaceAll("{ref}", ref) : `${verifyCmd} ${ref}`;
  try {
    const { stdout } = await execFn(cmd, { cwd: projectDir });
    const parsed = extractFirstJson(String(stdout));
    if (!parsed || typeof parsed.exists !== "boolean") {
      throw new Error("adapter must print JSON {exists, live, status} on stdout");
    }
    const alive = parsed.exists && parsed.live !== false;
    const result = alive
      ? { level: "tracker", verified: true, status: parsed.status ?? null }
      : { level: "tracker", verified: false, status: parsed.status ?? (parsed.exists ? "not-live" : "not-found") };
    try {
      fs.mkdirSync(path.dirname(cachePath(projectDir)), { recursive: true });
      fs.writeFileSync(cachePath(projectDir), JSON.stringify({ ...cache, [key]: { at: now(), result } }));
    } catch { /* cache is best-effort — the verdict stands without it */ }
    return result;
  } catch (err) {
    const why = String(err.message || err).split("\n")[0].slice(0, 120);
    return {
      level: "branch-ref", verified: null,
      note: `tracker verification degraded to branch-ref (${why}) — fix board.verify_cmd or its credentials`,
    };
  }
}
