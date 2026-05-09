/**
 * Golden tasks subprocess runner (KJC-TSK-0374). Spawns `kj run` in
 * a sandbox dir, reads back summary.md, evaluates the schema's
 * filesystem-dependent assertions (expected_test_files, allowed_loc_range),
 * and merges them with `assertFromSummary` into a single result.
 *
 * The kj subprocess + diff calls are injected so unit tests can drive
 * the runner without spawning anything (real e2e is opt-in via PR-3b).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runCommand as defaultRun } from "../utils/process.js";
import { parseSummary, assertFromSummary } from "./asserter.js";

async function findLatestSummary(workDir) {
  const journalRoot = path.join(workDir, ".karajan", "sessions");
  const sessions = await fs.readdir(journalRoot).catch(() => []);
  if (sessions.length === 0) return null;
  const stats = await Promise.all(sessions.map(async (id) => {
    const file = path.join(journalRoot, id, "summary.md");
    const stat = await fs.stat(file).catch(() => null);
    return stat ? { file, mtimeMs: stat.mtimeMs } : null;
  }));
  const valid = stats.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  return valid[0]?.file ?? null;
}

async function findMissingTestFiles(workDir, paths) {
  const checks = await Promise.all(paths.map(async (rel) =>
    [rel, await fs.stat(path.join(workDir, rel)).then(() => true).catch(() => false)]));
  return checks.filter(([, ok]) => !ok).map(([rel]) => rel);
}

async function totalLocSince(workDir, baseSha, run) {
  const res = await run("git", ["diff", "--numstat", `${baseSha}..HEAD`], { cwd: workDir }).catch(() => null);
  if (!res || res.exitCode !== 0) return null;
  return String(res.stdout || "").split("\n").filter(Boolean)
    .map((l) => l.split("\t")).filter(([a]) => a !== "-")
    .reduce((sum, [a]) => sum + Number(a || 0), 0);
}

export async function runGoldenTask(task, opts = {}) {
  const run = opts.run || defaultRun;
  const fsApi = opts.fs || fs;
  const workDir = opts.workDir;
  if (!workDir) throw new Error("runGoldenTask requires opts.workDir");

  const baseSha = opts.baseSha || null;
  const kjResult = await run("kj", ["run", task.prompt, "-y"], {
    cwd: workDir,
    timeout: (task.timeout_minutes || 30) * 60_000,
  });

  const summaryPath = opts.summaryPath || await findLatestSummary(workDir);
  if (!summaryPath) {
    return { ok: false, kjExit: kjResult?.exitCode ?? -1, failures: [{
      kind: "no_summary", expected: "summary.md", actual: null,
      message: "kj run finished without producing a summary.md",
    }] };
  }
  const content = await fsApi.readFile(summaryPath, "utf8");
  const parsed = parseSummary(content);
  const summaryAssertion = assertFromSummary(task, parsed);

  const failures = [...summaryAssertion.failures];

  if (Array.isArray(task.expected_test_files) && task.expected_test_files.length > 0) {
    const missing = await findMissingTestFiles(workDir, task.expected_test_files);
    if (missing.length > 0) {
      failures.push({ kind: "test_files_missing", expected: task.expected_test_files, actual: missing,
        message: `expected test files not produced: ${missing.join(", ")}` });
    }
  }

  if (baseSha) {
    const loc = await totalLocSince(workDir, baseSha, run);
    const [min, max] = task.allowed_loc_range;
    if (loc !== null && (loc < min || loc > max)) {
      failures.push({ kind: "loc_out_of_range", expected: `${min}..${max}`, actual: loc,
        message: `LOC added (${loc}) is outside the allowed range [${min}, ${max}]` });
    }
  }

  return {
    ok: failures.length === 0,
    kjExit: kjResult?.exitCode ?? null,
    summaryPath,
    parsed,
    failures,
  };
}
