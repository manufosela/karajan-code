/**
 * BOOT-A (KJC-TSK-0857, epic KJC-PCS-0088) — `kj bootstrap`: from an empty
 * directory to a project under the method, in one command.
 *
 * It invents nothing. The pieces already existed; what was missing was the
 * ORDER and somebody imposing it. The field report that opened the cold-start
 * ADR found nine walls on that path, and several of them fired precisely
 * because the repository had been raised by hand, in the wrong sequence.
 *
 * Rules this command obeys:
 *  - Idempotent. What is already there is reported as `already`, never redone.
 *  - Fail loud, never half. A step that needs the person's hands STOPS the
 *    sequence and says which one; nothing downstream pretends it ran.
 *  - No guarantees without git: the gates live in git hooks, so the repo comes
 *    first and a git that cannot run is the end of the line, not a warning.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureGitRepo } from "./init.js";
import { initCommand } from "./init.js";
import { envInstallCommand } from "./env.js";
import { runStartScript, START_SCRIPT_CONTRACT } from "../start/project-script.js";

const STEP_LABEL = {
  git: "repositorio",
  config: "configuración del proyecto",
  method: "método activo (harness, gate y RAG)",
  contract: "commit del contrato",
  start: "arranque del proyecto",
};

/** What kj generates and the whole team must inherit by cloning. */
const CONTRACT_PATHS = [
  ".gitignore",
  ".karajan/hooks",
  ".karajan/review-gate",
  ".karajan/adrs",
  ".karajan/policy.yml",
  ".claude",
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
];
const CONTRACT_MESSAGE = "chore(bootstrap): el contrato del método, para que quien clone lo herede";

const hasCommits = (projectDir, git) => {
  try { git(["rev-parse", "--verify", "HEAD"]); return true; } catch { return false; }
};

/**
 * @returns {Promise<{ok: boolean, pending: string|null, steps: Array<{name: string, status: "done"|"already"|"pending"}>}>}
 */
export async function bootstrapCommand({ config = {}, logger = console, flags = {}, deps = {} } = {}) {
  const projectDir = config.projectDir || process.cwd();
  const steps = [];
  const say = (name, status, detail) => {
    steps.push({ name, status });
    const mark = status === "already" ? "·" : "✓";
    logger.info?.(`${mark} ${STEP_LABEL[name]}${detail ? ` — ${detail}` : ""}`);
  };
  const stop = (name, why) => {
    steps.push({ name, status: "pending" });
    logger.error?.(`✗ ${STEP_LABEL[name]} — ${why}`);
    return { ok: false, pending: name, steps };
  };

  // 1. The repository. Without it there are no hooks, and without hooks there
  //    are no guarantees: this is the one step that cannot be skipped.
  const hadRepo = existsSync(join(projectDir, ".git"));
  if (!ensureGitRepo({ projectDir, logger: { info() {}, warn() {} }, gitFn: deps.gitFn })) {
    return stop("git", "git no está disponible y las garantías de Karajan viven en sus hooks");
  }
  say("git", hadRepo ? "already" : "done", hadRepo ? "ya existía" : "creado, sin commit todavía");

  // 2. The project's own configuration.
  const hasConfig = existsSync(join(projectDir, ".karajan", "kj.config.yml"));
  if (hasConfig) say("config", "already", "ya estaba");
  else {
    const init = await (deps.init ?? initCommand)({ logger, flags: { ...flags, noInteractive: true } });
    if (init?.exitCode) return stop("config", "queda algo que solo puedes hacer tú, lo tienes arriba");
    say("config", "done");
  }

  // 3. The method itself: harness, verdict gate, playbook and RAG index. This
  //    is the step that turns an installed kj into an enforced one.
  const hasGate = existsSync(join(projectDir, ".karajan", "review-gate"));
  if (hasGate) say("method", "already", "ya estaba activo");
  else {
    const env = await (deps.env ?? envInstallCommand)({ config, logger, flags: { yes: true } });
    if (env?.exitCode) return stop("method", "queda algo que solo puedes hacer tú, lo tienes arriba");
    say("method", "done");
  }

  // 4. The contract commit. project-new.md asked the USER for it, and it was
  //    the commit their own freshly installed gates rejected: the review gate
  //    (KJC-BUG-0165) and the branch guard (KJC-BUG-0186) both exempt it now,
  //    so kj can make it itself instead of leaving the person to fight it.
  //    Only what kj generated, only while the repo has no commit, never the
  //    person's own code. This is NOT the supervisor seal, which stays a human
  //    act with its own four layers (ADR 0009).
  const git = deps.gitRun ?? ((args) => execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }));
  if (hasCommits(projectDir, git)) say("contract", "already", "el repositorio ya tiene historia");
  else {
    const present = CONTRACT_PATHS.filter((p) => existsSync(join(projectDir, p)));
    if (present.length === 0) say("contract", "already", "no hay contrato que commitear");
    else {
      try {
        git(["add", "--", ...present]);
        git(["commit", "-m", CONTRACT_MESSAGE]);
      } catch (err) {
        // Nunca explotar aquí: lo más probable es que falte la identidad del
        // clon, y ese cauce ya lo pide el paso anterior (KJC-BUG-0188).
        return stop("contract", `git no pudo commitear el contrato: ${String(err.message).split("\n")[0]}`);
      }
      say("contract", "done", `${present.length} ruta(s) del contrato`);
    }
  }

  // 5. Does the project actually run? kj verified the method; nobody verified
  //    the application (BOOT-C, KJC-TSK-0862). It REPORTS, never blocks: a
  //    start script written badly must not stop work over something unrelated,
  //    and a tree that was already broken has to be said BEFORE implementing.
  const start = await (deps.start ?? runStartScript)({ projectDir, config });
  if (start.status === "absent") say("start", "already", `sin guion de arranque — ${START_SCRIPT_CONTRACT}`);
  else if (start.status === "ok") say("start", "done", "el proyecto arranca y su humo pasa");
  else say("start", "already", `el árbol YA venía roto (${start.status}) — no lo ha causado este trabajo`);

  return { ok: true, pending: null, steps };
}
