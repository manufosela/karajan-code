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

import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureGitRepo } from "./init.js";
import { initCommand } from "./init.js";
import { envInstallCommand } from "./env.js";

const STEP_LABEL = {
  git: "repositorio",
  config: "configuración del proyecto",
  method: "método activo (harness, gate y RAG)",
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

  return { ok: true, pending: null, steps };
}
