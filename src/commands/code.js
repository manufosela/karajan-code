import fs from "node:fs/promises";
import { createAgent } from "../agents/index.js";
import { traceActivity } from "../agents/activity.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { buildCoderPrompt } from "../prompts/coder.js";
import { resolveCardContext } from "../prompts/card-context.js";
import { composeTask, ragQueryText, resolveRagContext } from "../prompts/session-context.js";
import { resolveRole } from "../config.js";
import { routedCoderConfig } from "../hu/coder-routing.js";
import { rejectedReview } from "../review/retry-findings.js";
// KJC-TSK-0859: the agents no longer substitute a dead model behind your back,
// so the command needs the declared chain, with the one-shot policy a command
// deserves (KJC-BUG-0194 moved it to its own module: audit needs the same).
import { withBrainRecovery } from "../brain/with-brain-recovery.js";
import { buildRoleFallbackChain } from "../brain/role-fallback-chain.js";
import { ONE_SHOT_POLICY } from "../brain/one-shot-policy.js";
import { sealPanel } from "../environment/panel.js";
import { withCliRunLog } from "../utils/cli-run-log.js";
import { createCliProgressReporter } from "../utils/cli-progress.js";

export async function codeCommand({ task, config, logger, flags = {} }) {
  // KJC-BUG-0512: a config without projectDir is the project kj runs in, as for every other command.
  const projectDir = config?.projectDir || process.cwd();
  return withCliRunLog("code", { projectDir, logger }, async ({ runLog }) => {
    const coderRole = resolveRole(config, "coder");
    // KJC-TSK-0864: no quota, not authenticated or simply absent? This THROWS
    // with the agent named. The one thing it never does is quietly fall back
    // to whoever happens to be reachable.
    await assertAgentsAvailable([coderRole.provider]);
    const card = await resolveCardContext({ projectDir, ref: flags.card || null });
    if (card?.external) logger.warn(`card ${card.huId} lives on a board kj cannot read — passing the reference, not its text`);
    else if (card) logger.info(`Card ${card.huId}: ${card.title}`);
    const effectiveTask = taskOrCardTitle(task, card);
    if (!effectiveTask) throw new Error("No task provided. Pass a task argument or --task-file <path>.");
    // HU-3533: the card's tier picks the coder's model, as kj run's coder stage did.
    // HU-3533: a retry carries the review's findings and climbs to the most capable model.
    const review = flags.retry ? await rejectedReview({ projectDir }) : null;
    if (review) logger.info(`Retry: ${review.count} finding(s) of ${review.reviewer}'s rejection reach the coder`);
    const routed = routedCoderConfig({ config, card, attempt: review ? 2 : 1 });
    logger.info(`Coder (${coderRole.provider}) starting... model: ${routed.reason}`);
    runLog.logText(`[coder] provider=${coderRole.provider} model=${routed.route?.model ?? "declared"}`);
    const coder = traceActivity(createAgent(coderRole.provider, routed.config, logger), { name: coderRole.provider, role: "coder", projectDir, logger });
    let coderRules = null;
    if (config.coder_rules) {
      try {
        coderRules = await fs.readFile(config.coder_rules, "utf8");
      } catch { /* configured coder_rules path not found — try fallback */
        try { coderRules = await fs.readFile("coder-rules.md", "utf8"); } catch { /* no coder rules file */ }
      }
    }
    // The method's first invariant is that the RAG answers before you assume.
    // The session asks on the coder's behalf: a subprocess coder cannot run
    // `kj rag query` itself, so it used to guess the codebase instead.
    const rag = await resolveRagContext({ task: ragQueryText({ task, card, review }), config, logger });
    // The pipeline always passed projectDir (it arms the directory-boundary
    // rule and the skills section) and the provider. `kj code` did not, so the
    // declared coder got a weaker prompt from the session than from `kj run`.
    const prompt = await buildCoderPrompt({
      task: composeTask(effectiveTask, [card?.section, review?.section, rag?.section]),
      coderRules,
      methodology: config.development?.methodology || "tdd",
      projectDir,
      provider: coderRole.provider,
      huId: card?.huId ?? null,
      acceptanceTests: card?.acceptanceTests ?? null,
      serenaEnabled: Boolean(config.serena?.enabled),
      rtkAvailable: Boolean(config.rtk?.available),
    });
    // HU-3533: --brief is for the agent that orchestrates: no live stream, only the end of the answer.
    const progress = createCliProgressReporter({ role: "coder", quiet: Boolean(flags.brief) });
    let result;
    try {
      result = await withBrainRecovery({
        agent: { runTask: (args) => coder.runTask(args), provider: coderRole.provider, model: routed.route?.model ?? coderRole.model },
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
      console.log(flags.brief ? briefOf(result.output) : result.output);
    }
    if (result.error) {
      logger.warn(result.error);
    }
    logger.info(`Coder completed (exit ${result.exitCode})`);
    // KJC-TSK-0873: aqui es donde el panel SE CUMPLE — el coder declarado ha
    // escrito. Queda asentado junto a las desviaciones para que el recuento de
    // kj report signifique algo: casi siempre y casi nunca no se ven igual.
    // Solo cuenta como cumplido si el coder declarado TERMINO bien: ni una
    // salida distinta de cero ni una caida al fallback son "escribio el coder
    // que elegiste" (dos catches de la review). Si escribio otro, se asienta
    // como desviacion nombrandolo.
    const ranBy = result.provider || coderRole.provider;
    if (result.exitCode === 0) {
      try { sealPanel({ projectDir, coder: coderRole.provider, host: ranBy, honoured: ranBy === coderRole.provider }); }
      catch (err) { logger.warn(`panel: no se pudo sellar quién escribió (${err.message}) — el trabajo del coder no se toca`); }
    }
    // The work is in the tree, not committed: the gate is the next step and a
    // DIFFERENT AI runs it. Saying so here is what keeps the panel honest.
    logger.info(`The work is in the tree. Review it before committing: kj review --staged (a different AI than ${coderRole.provider}).`);
    runLog.logText(`[coder] finished (exit=${result.exitCode})`);
    const route = routed.route ? { model: routed.route.model, effort: routed.route.effort } : null;
    return { ok: true, provider: coderRole.provider, card: card?.huId ?? null, route, ragSources: rag?.sources ?? [] };
  });
}

/** A written task wins; with --card and none, the card's title says what to do. */
function taskOrCardTitle(task, card) {
  const written = typeof task === "string" ? task.trim() : "";
  return written || card?.title || null;
}

const BRIEF_LINES = 30;
/** HU-3533: the end of the coder's answer, where it sums up, and how much was left out. */
function briefOf(output) {
  const lines = String(output).trimEnd().split("\n");
  if (lines.length <= BRIEF_LINES) return lines.join("\n");
  return [`(${lines.length - BRIEF_LINES} earlier line(s) left out: the full answer is in kj's run log)`, ...lines.slice(-BRIEF_LINES)].join("\n");
}
