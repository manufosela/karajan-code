// KJC-TSK-0570 (Onboard C) — `kj start`: the single entry point to the Brain.
// Wires the read-only sweep (0568) → deterministic assessment (0569) → haiku
// decider (0569) and reports the recommended next step. This slice WRITES
// NOTHING: dispatching the chosen intent (harden/index/run/plan) with
// confirmation lands in the follow-up. --json / --yes / no-TTY emit the
// assessment + intent and exit. Collaborators are injected for testing.
import { runReadOnlySweep } from "../start/sweep.js";
import { buildAssessment } from "../start/assessment.js";
import { StartDecidorRole } from "../start/start-decider-role.js";

// Each intent maps to the saved command the follow-up will dispatch.
const NEXT_STEP = {
  ASSESS_ONLY: "Everything looks healthy — nothing to do.",
  RECOMMEND_HARDEN: "Suggested: `kj harden --interactive`",
  RECOMMEND_INDEX: "Suggested: `kj rag index`",
  START_TASK: 'Suggested: `kj run "<task>"`',
  PROPOSE_PLAN: 'Suggested: `kj plan "<goal>"`',
};

const ASK_FALLBACK = "What would you like to do with this project?";

// The decider has its own quota/parse recovery; a spawn-level failure (CLI not
// installed) still throws, so we degrade here too — `kj start` never crashes.
async function decide({ task, text, config, logger, makeDecider }) {
  const decider = makeDecider({ config, logger });
  try {
    const decision = await decider.execute({ userMessage: task, assessment: text });
    return decision.result || {};
  } catch (err) {
    logger?.warn?.(`[start] decider unavailable (${err?.message || err}) — asking the user.`);
    return { intent: "ASK_USER", rationale: "Decider unavailable.", questionToAsk: ASK_FALLBACK, degraded: true };
  }
}

export async function startCommand({ task = "", config, logger, flags = {}, deps = {} }) {
  const sweep = deps.runReadOnlySweep || runReadOnlySweep;
  const assess = deps.buildAssessment || buildAssessment;
  const makeDecider = deps.makeDecider || ((opts) => new StartDecidorRole(opts));

  const bundle = await sweep(config.projectDir, { declared: flags.maturity || null });
  const { text, summary } = assess(bundle);
  const result = await decide({ task, text, config, logger, makeDecider });

  if (flags.json) {
    console.log(JSON.stringify({ maturity: summary.maturity, assessment: text, ...result }, null, 2));
    return { ok: true, intent: result.intent };
  }

  console.log(`${text}\n`);
  if (result.intent === "ASK_USER") {
    console.log(`❓ ${result.questionToAsk || ASK_FALLBACK}`);
  } else {
    if (result.rationale) console.log(`→ ${result.rationale}`);
    const step = NEXT_STEP[result.intent];
    if (step) console.log(`  ${step}`);
  }
  return { ok: true, intent: result.intent };
}
