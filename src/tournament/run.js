/**
 * tournament/run — TOR-A (KJC-TSK-0723, epic KJC-PCS-0073).
 *
 * Orca's pitch is "fan one prompt across N agents, compare, merge the
 * winner" — with a human eyeballing diffs. Karajan's tournament keeps the
 * fan-out and replaces the eyeballing with the method: this module runs the
 * SAME task through N coders, each in its own isolated worktree lane (the
 * PAR machinery), and collects per-lane evidence (diff, suite result, agent
 * log, metadata) for the deterministic scoreboard (TOR-B) and the governed
 * judgement/merge (TOR-C). No commits here: lanes stay as working trees.
 *
 * A COMPOSER, not a new pipeline: lanes = `git worktree` under
 * .kj/worktrees (same dir as kj worktree / headless lanes); agents = the
 * registered adapters with the PAR idiom (laneConfig.projectDir = lane,
 * task.cwd = lane); suite = the package manager the repo actually uses.
 * Every dependency is injectable; one lane's failure never sinks another.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAgent } from "../agents/index.js";
import { bootstrapWorktree } from "../hu/worktree-bootstrap.js";
import { detectPackageManager } from "../harden/workflow-engine.js";
import { PM_COMMANDS } from "../harden/workflow-templates.js";

const execFileAsync = promisify(execFile);
const WORKTREE_DIR = ".kj/worktrees"; // shared with kj worktree + headless lanes
const TOURNAMENT_DIR = ".kj/tournaments";
const SUITE_TIMEOUT_MS = 15 * 60 * 1000;

const defaultGit = (args, cwd) => execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });

async function defaultRunSuite({ lanePath }) {
  const pm = detectPackageManager(lanePath);
  const testCmd = (PM_COMMANDS[pm] || PM_COMMANDS.npm).test.split(" ");
  try {
    const res = await execFileAsync(testCmd[0], testCmd.slice(1), {
      cwd: lanePath, timeout: SUITE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, exitCode: 0, output: res.stdout || "" };
  } catch (err) {
    return { ok: false, exitCode: err.code ?? 1, output: `${err.stdout || ""}\n${err.stderr || ""}` };
  }
}

/**
 * Fan the task out to every coder and collect per-lane results.
 * @returns {Promise<{id: string, dir: string, lanes: Array<object>}>}
 */
export async function runTournament({ task, coders = [], config = {}, logger = console, deps = {} }) {
  const {
    createAgentFn = createAgent,
    gitFn = defaultGit,
    bootstrapFn = bootstrapWorktree,
    runSuiteFn = defaultRunSuite,
  } = deps;
  if (!task || !String(task).trim()) throw new Error("tournament: falta la tarea");
  if (!Array.isArray(coders) || coders.length < 2) {
    throw new Error("tournament: hacen falta al menos 2 coders (--coders a,b) — con uno no hay torneo");
  }
  // Coder names feed lane/result PATHS: a strict slug (no separators, no
  // leading dot, no traversal) before any filesystem use — codex's catch.
  const CODER_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/i;
  for (const c of coders) {
    if (!CODER_RE.test(String(c))) {
      throw new Error(`tournament: nombre de coder inválido "${c}" — solo letras, dígitos, guiones (sin rutas)`);
    }
  }

  const projectDir = config.projectDir || process.cwd();
  const id = `tor-${Date.now().toString(36)}`;
  const resultsRoot = path.join(projectDir, TOURNAMENT_DIR, id);
  fs.mkdirSync(resultsRoot, { recursive: true });
  logger?.info?.(`kj tournament ${id}: ${coders.length} coders → ${coders.join(", ")}`);

  const settled = await Promise.allSettled(coders.map((coder) => runLane({
    coder, task, id, projectDir, resultsRoot, config, logger,
    createAgentFn, gitFn, bootstrapFn, runSuiteFn,
  })));

  const lanes = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { coder: coders[i], status: "failed", error: String(s.reason?.message || s.reason), dir: path.join(resultsRoot, coders[i]) },
  );

  const summary = { id, task: String(task), created_at: new Date().toISOString(), lanes };
  fs.writeFileSync(path.join(resultsRoot, "summary.json"), JSON.stringify(summary, null, 2));
  for (const lane of lanes) {
    let state = `FAILED: ${lane.error}`;
    if (lane.status === "completed") state = lane.suite?.ok ? "suite verde" : "suite ROJA";
    logger?.info?.(`  ${lane.coder.padEnd(10)} ${lane.status.padEnd(10)} ${state}`);
  }
  return { id, dir: resultsRoot, lanes };
}

async function runLane({ coder, task, id, projectDir, resultsRoot, config, logger, createAgentFn, gitFn, bootstrapFn, runSuiteFn }) {
  const slug = `${id}-${coder}`;
  const lanePath = path.join(projectDir, WORKTREE_DIR, slug);
  const branch = `tor/${slug}`;
  const laneDir = path.join(resultsRoot, coder);
  fs.mkdirSync(laneDir, { recursive: true });

  await gitFn(["worktree", "add", "-b", branch, lanePath], projectDir);
  await bootstrapFn({ worktreePath: lanePath, setupCommand: config?.session?.worktree_setup || null });

  // The PAR idiom: the lane IS the project for this agent. A tournament
  // coder MUST be able to write files — found live in the first real run:
  // codex without auto_approve produced an honest but useless EMPTY diff.
  const laneConfig = {
    ...config,
    projectDir: lanePath,
    coder_options: { ...config?.coder_options, auto_approve: true },
  };
  const prompt =
    `You are one of ${"several"} coders solving the SAME task independently. ` +
    `Work ONLY inside this directory (your isolated worktree). Implement the task with tests. Do not commit.\n\nTASK:\n${task}`;
  const started = Date.now();
  const result = await createAgentFn(coder, laneConfig, logger).runTask({ prompt, role: "coder", cwd: lanePath });
  fs.writeFileSync(path.join(laneDir, "agent.log"), String(result?.output ?? ""));
  if (!result?.ok) throw new Error(`coder ${coder} failed: ${result?.error || "no output"}`);

  // Intent-to-add first: plain `git diff` is blind to UNTRACKED files, and
  // new files are the most common coder output — codex's catch.
  await gitFn(["add", "-N", "."], lanePath);
  const diff = await gitFn(["diff"], lanePath);
  fs.writeFileSync(path.join(laneDir, "diff.patch"), diff.stdout || "");

  const suite = await runSuiteFn({ lanePath });
  fs.writeFileSync(path.join(laneDir, "suite.log"), suite.output || "");

  const meta = {
    coder, branch, lane: lanePath, tournament: id,
    duration_ms: Date.now() - started,
    diff_bytes: (diff.stdout || "").length,
    suite: { ok: suite.ok, exitCode: suite.exitCode },
  };
  fs.writeFileSync(path.join(laneDir, "meta.json"), JSON.stringify(meta, null, 2));

  return { coder, status: "completed", branch, lane: lanePath, dir: laneDir, suite: { ok: suite.ok, exitCode: suite.exitCode } };
}
