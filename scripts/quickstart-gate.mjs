#!/usr/bin/env node
/**
 * Quickstart gate (KJC-TSK-0635) — the landing's Quick Start, end to end,
 * against the PACKED tarball, with a REAL coder run.
 *
 * Run manually before a release (`npm run verify-quickstart`). Opt-in
 * because the coder run spends real subscription quota (~$0.5-1.5, 5-8
 * minutes). What it catches that unit tests and verify-pack cannot:
 * the exact first-contact sequence a new user follows — install → init →
 * `kj run` on a no-remote repo → playable artifact (2026-07-19: that
 * sequence surfaced KJC-BUG-0111/0112/0113 in one afternoon).
 *
 * Asserts: run exits 0 · report says approved · index.html exists with
 * game markers · "skipping push/PR" logged · ZERO Solomon escalations.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TASK = "Create a tic-tac-toe game in a single self-contained index.html — vanilla HTML, CSS and JavaScript, no server and no build step. The human plays X, the bot plays O and blocks or takes a winning move when it can. Detect wins and draws, and add a New Game button. Opening index.html in a browser must be enough to play.";

function fail(msg, detail) {
  console.error(`\n✗ quickstart-gate: ${msg}`);
  if (detail) console.error(String(detail).slice(-1200));
  process.exitCode = 1;
  throw new Error(msg);
}

let work = null;
try {
  console.log("quickstart-gate: packing…");
  const packOut = execFileSync("npm", ["pack", "--json", "--silent"], { cwd: repoRoot, encoding: "utf8" });
  const tgz = path.join(repoRoot, JSON.parse(packOut)[0].filename);

  work = fs.mkdtempSync(path.join(os.tmpdir(), "kj-qs-gate-"));
  const prefix = path.join(work, "npm");
  const project = path.join(work, "project");
  fs.mkdirSync(project, { recursive: true });

  console.log("quickstart-gate: installing the tarball (isolated prefix)…");
  execFileSync("npm", ["install", "-g", tgz, "--no-audit", "--no-fund", "--silent", "--prefix", prefix], { encoding: "utf8" });
  const kj = path.join(prefix, "bin", "kj");
  fs.rmSync(tgz, { force: true });

  // Isolated KARAJAN_HOME: faithful to a brand-new user (no global
  // config) and never touches the maintainer's real ~/.karajan.
  const env = { ...process.env, KARAJAN_HOME: path.join(work, "karajan-home") };
  delete env.CLAUDECODE;
  // If the maintainer's machine has a SonarQube server running, preflight
  // (correctly) demands a token the isolated home doesn't have. Forward the
  // maintainer's token so the gate exercises the sonar stage instead of
  // dying in preflight. A machine with no sonar server is unaffected.
  if (!env.KJ_SONAR_TOKEN) {
    try {
      const cfg = fs.readFileSync(path.join(os.homedir(), ".karajan", "kj.config.yml"), "utf8");
      const m = cfg.match(/^\s*token:\s*(sqa_[A-Za-z0-9]+|squ_[A-Za-z0-9]+)\s*$/m);
      if (m) env.KJ_SONAR_TOKEN = m[1];
    } catch { /* no global config — brand-new machine, nothing to forward */ }
  }

  console.log("quickstart-gate: git init + kj init (unattended)…");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });
  const init = spawnSync(kj, ["init", "--no-interactive", "--no-ollama", "--no-rtk", "--no-squeezr", "--no-qmd"], {
    cwd: project, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000,
  });
  if (init.status !== 0) fail("kj init failed", init.stderr || init.stdout);

  console.log("quickstart-gate: kj run (REAL coder — this spends quota, ~5-8 min)…");
  const runRes = spawnSync(kj, ["run", "-y", TASK], {
    cwd: project, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20 * 60 * 1000,
  });
  const runOut = `${runRes.stdout || ""}${runRes.stderr || ""}`;
  fs.writeFileSync(path.join(work, "run.log"), runOut);

  if (runRes.status !== 0) fail(`kj run exited ${runRes.status} (log: ${work}/run.log)`, runOut);
  if (/escalating to Solomon/i.test(runOut)) fail(`Solomon escalation detected — the happy path must not consult Solomon (log: ${work}/run.log)`);
  // KJC-BUG-0112 regression: a remote-less repo must never attempt (and
  // fail) push/fetch automation. With init's defaults (auto_push: false)
  // the "skipping push/PR" line is legitimately absent, so assert the
  // absence of failure symptoms rather than the presence of the skip line.
  if (/failed to push|fatal: .*origin|couldn't find remote/i.test(runOut)) fail(`push/fetch against a missing remote detected (log: ${work}/run.log)`);

  const html = path.join(project, "index.html");
  if (!fs.existsSync(html)) fail("index.html was not created");
  const htmlText = fs.readFileSync(html, "utf8");
  if (!/new game/i.test(htmlText)) fail("index.html has no New Game control — not the requested game");

  const report = spawnSync(kj, ["report"], { cwd: project, env, encoding: "utf8", timeout: 60000 });
  if (!/approved/i.test(`${report.stdout || ""}`)) fail("kj report does not say approved", report.stdout);

  console.log("\n✓ quickstart-gate: install → init → run → playable index.html → approved. Ship it.");
} finally {
  if (work && process.exitCode !== 1 && fs.existsSync(work)) fs.rmSync(work, { recursive: true, force: true });
  if (work && process.exitCode === 1) console.error(`quickstart-gate: workdir kept for inspection: ${work}`);
}
