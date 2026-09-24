import fs from "node:fs/promises";
import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { buildCoderPrompt } from "../prompts/coder.js";
import { resolveCardContext } from "../prompts/card-context.js";
import { composeTask, resolveRagContext } from "../prompts/session-context.js";
import { resolveRole } from "../config.js";
import { withBrainRecovery, DEFAULT_RECOVERY_POLICY } from "../brain/with-brain-recovery.js";
import { buildRoleFallbackChain } from "../brain/role-fallback-chain.js";
import { ERROR_CLASS } from "../brain/agent-error-classifier.js";

// KJC-TSK-0859: the agents no longer substitute a dead model behind your back,
// so the command needs the declared chain. A one-shot CLI must not inherit the
// pipeline's standby either: sleeping five hours inside `kj code` would be
// worse than the failure. A quota wall takes the next candidate at once, and
// with none left it stops and says what it tried.
const ONE_SHOT_POLICY = Object.freeze({
  ...DEFAULT_RECOVERY_POLICY,
  classes: {
    ...DEFAULT_RECOVERY_POLICY.classes,
    [ERROR_CLASS.QUOTA_EXHAUSTED_DAILY]: { mode: "abort", maxRetries: 0, fallbackEligible: true, fallbackImmediate: true },
    [ERROR_CLASS.QUOTA_EXHAUSTED_MONTHLY]: { mode: "abort", maxRetries: 0, fallbackEligible: true, fallbackImmediate: true },
  },
});
import { withCliRunLog } from "../utils/cli-run-log.js";
import { createCliProgressReporter } from "../utils/cli-progress.js";

export async function codeCommand({ task, config, logger, flags = {} }) {
  return withCliRunLog("code", { projectDir: config?.projectDir, logger }, async ({ runLog }) => {
    const coderRole = resolveRole(config, "coder");
    // KJC-TSK-0864: no quota, not authenticated or simply absent? This THROWS
    // with the agent named. The one thing it never does is quietly fall back
    // to whoever happens to be reachable.
    await assertAgentsAvailable([coderRole.provider]);
    logger.info(`Coder (${coderRole.provider}) starting...`);
    runLog.logText(`[coder] provider=${coderRole.provider}`);
    const coder = createAgent(coderRole.provider, config, logger);
    let coderRules = null;
    if (config.coder_rules) {
      try {
        coderRules = await fs.readFile(config.coder_rules, "utf8");
      } catch { /* configured coder_rules path not found — try fallback */
        try { coderRules = await fs.readFile("coder-rules.md", "utf8"); } catch { /* no coder rules file */ }
      }
    }
    const card = await resolveCardContext({ projectDir: config.projectDir, ref: flags.card || null });
    if (card?.external) logger.warn(`card ${card.huId} lives on a board kj cannot read — passing the reference, not its text`);
    else if (card) logger.info(`Card ${card.huId}: ${card.title}`);
    // The method's first invariant is that the RAG answers before you assume.
    // The session asks on the coder's behalf: a subprocess coder cannot run
    // `kj rag query` itself, so it used to guess the codebase instead.
    const rag = await resolveRagContext({ task, config, logger });
    // The pipeline always passed projectDir (it arms the directory-boundary
    // rule and the skills section) and the provider. `kj code` did not, so the
    // declared coder got a weaker prompt from the session than from `kj run`.
    const prompt = await buildCoderPrompt({
      task: composeTask(task, [card?.section, rag?.section]),
      coderRules,
      methodology: config.development?.methodology || "tdd",
      projectDir: config.projectDir,
      provider: coderRole.provider,
      huId: card?.huId ?? null,
      acceptanceTests: card?.acceptanceTests ?? null,
      serenaEnabled: Boolean(config.serena?.enabled),
      rtkAvailable: Boolean(config.rtk?.available),
    });
    const progress = createCliProgressReporter({ role: "coder" });
    let result;
    try {
      result = await withBrainRecovery({
        agent: { runTask: (args) => coder.runTask(args), provider: coderRole.provider, model: coderRole.model },
        taskArgs: { prompt, onOutput: progress.onOutput, role: "coder" },
        role: "coder",
        provider: coderRole.provider,
        logger,
        policy: ONE_SHOT_POLICY,
        fallback: buildRoleFallbackChain({ config, role: "coder", logger }),
      });
      progress.finish(result.ok ? "done" : "failed");
    } catch (err) { progress.finish("failed"); throw err; }
    if (!result.ok) {
      if (result.error) logger.error(result.error);
      throw new Error(result.error || result.output || `Coder failed (exit ${result.exitCode})`);
    }
    if (result.output) {
      console.log(result.output);
    }
    if (result.error) {
      logger.warn(result.error);
    }
    logger.info(`Coder completed (exit ${result.exitCode})`);
    // The work is in the tree, not committed: the gate is the next step and a
    // DIFFERENT AI runs it. Saying so here is what keeps the panel honest.
    logger.info(`The work is in the tree. Review it before committing: kj review --staged (a different AI than ${coderRole.provider}).`);
    runLog.logText(`[coder] finished (exit=${result.exitCode})`);
    return { ok: true, provider: coderRole.provider, card: card?.huId ?? null, ragSources: rag?.sources ?? [] };
  });
}
