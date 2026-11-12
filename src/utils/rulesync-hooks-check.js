/**
 * HU-3995 (issue #3847, slice 1): a read-only check. It runs the pinned rulesync in a
 * temporary directory outside the repository, with a clean environment, and compares the
 * hooks subtree it generates for each agent with what the repository holds. It writes
 * nothing in the repository and seals nothing (the seal is slice 2).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./process.js";
import { rulesyncCommand } from "./rulesync.js";

/** The version and tarball hash measured by the spike (docs/spikes/rulesync-determinism.md). */
export const RULESYNC_PIN = Object.freeze({
  version: "43.1.2",
  integrity: "sha512-W1YYWI3sPVUZ/tiKy2mC2Epgu352IKF2QGvBrUSbeQ8EeTo2V0csZK9ELvra+3RHwmdVT1/PoPjMhKe3Gn+dXQ==",
});

// Only the hooks subtree counts (Antigravity's sits under "rulesync"): the files hold other keys too.
const jsonSubtree = (key) => (text) => JSON.stringify(JSON.parse(text)[key] ?? null);

/** Each agent's hooks file in project scope, and how to read its hooks subtree. */
export const HOOK_TARGETS = Object.freeze({
  claudecode: { file: ".claude/settings.json", subtree: jsonSubtree("hooks") },
  codexcli: { file: ".codex/hooks.json", subtree: jsonSubtree("hooks") },
  "antigravity-cli": { file: ".agents/hooks.json", subtree: jsonSubtree("rulesync") },
  opencode: { file: ".opencode/plugins/rulesync-hooks.js", subtree: (text) => text },
});

const RUN_TIMEOUT_MS = 60_000;
const SKIPPED_RE = /Skipped hook event\(s\) for ([\w-]+) \(not supported\):\s*([^\n]*)/g;

function integrityProblems(projectDir, pin) {
  let integrity;
  try {
    const lock = JSON.parse(readFileSync(join(projectDir, "package-lock.json"), "utf8"));
    integrity = lock.packages?.["node_modules/rulesync"]?.integrity;
  } catch (err) {
    return [`package-lock.json could not be read (${err.message}): the rulesync hash is unverified`];
  }
  return integrity === pin.integrity ? [] : [`rulesync integrity in package-lock.json is ${integrity ?? "absent"}, expected ${pin.integrity}`];
}

/** A fresh copy of the rulesync source, outside the repository. */
function copySource(projectDir, project) {
  const source = join(projectDir, ".rulesync");
  if (!existsSync(source)) throw new Error(`${source}: missing, there is no rulesync source to generate hooks from`);
  cpSync(source, join(project, ".rulesync"), { recursive: true });
  const config = join(projectDir, "rulesync.jsonc");
  if (existsSync(config)) cpSync(config, join(project, "rulesync.jsonc"));
}

async function generate({ projectDir, run, pin, targets, opts }) {
  const [vCmd, vArgs] = rulesyncCommand(projectDir, ["--version"]);
  const ver = await run(vCmd, vArgs, opts);
  const version = String(ver.stdout ?? "").trim();
  const problems = version === pin.version ? [] : [`rulesync version is "${version}", expected ${pin.version}`];
  const [cmd, args] = rulesyncCommand(projectDir, ["generate", "--targets", targets.join(","), "--features", "hooks"]);
  const res = await run(cmd, args, opts);
  if (res.exitCode !== 0) return [...problems, `rulesync generate failed: ${res.stderr?.trim() || `exit code ${res.exitCode}`}`];
  const log = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  for (const [, target, events] of log.matchAll(SKIPPED_RE)) problems.push(`rulesync skipped hook events for ${target}: ${events.trim()}`);
  return problems;
}

function compareTarget(target, projectDir, project) {
  const { file, subtree } = HOOK_TARGETS[target];
  const repo = join(projectDir, file);
  const fresh = join(project, file);
  if (!existsSync(fresh)) return `${target}: rulesync generated no ${file}`;
  if (!existsSync(repo)) return `${target}: ${file} is missing from the repository`;
  try {
    return subtree(readFileSync(repo, "utf8")) === subtree(readFileSync(fresh, "utf8")) ? null : `${target}: the hooks in ${file} differ from what rulesync generates`;
  } catch (err) {
    return `${target}: ${file} could not be read (${err.message})`;
  }
}

/** Returns `{ ok, problems }`; throws when the project has no `.rulesync/` source. */
export async function checkRulesyncHooks({ projectDir, run = runCommand, pin = RULESYNC_PIN, targets = Object.keys(HOOK_TARGETS) }) {
  const unknown = targets.filter((t) => !Object.hasOwn(HOOK_TARGETS, t));
  if (unknown.length) throw new Error(`rulesync hooks check: unknown target(s) ${unknown.join(", ")}`);
  const work = mkdtempSync(join(tmpdir(), "kj-rulesync-hooks-"));
  try {
    const project = join(work, "project");
    const home = join(work, "home");
    mkdirSync(home);
    copySource(projectDir, project);
    const opts = { cwd: project, extendEnv: false, env: { PATH: process.env.PATH ?? "", HOME: home }, timeout: RUN_TIMEOUT_MS };
    const problems = [...integrityProblems(projectDir, pin), ...await generate({ projectDir, run, pin, targets, opts })];
    if (!problems.some((p) => p.startsWith("rulesync generate failed"))) {
      problems.push(...targets.map((t) => compareTarget(t, projectDir, project)).filter(Boolean));
    }
    return { ok: problems.length === 0, problems };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
