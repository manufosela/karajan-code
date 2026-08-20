// KJC-TSK-0570 (Onboard C) — `kj start`: the single entry point to the Brain.
// Wires the read-only sweep (0568) → deterministic assessment (0569) → haiku
// decider (0569), reports the recommended next step, and — interactively only —
// confirms and dispatches the chosen intent to its saved command
// (harden/rag/run/plan). --json / --yes / no-TTY stay read-only: emit the
// assessment + intent and apply nothing. Collaborators are injected for testing.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { runReadOnlySweep } from "../start/sweep.js";
import { buildAssessment } from "../start/assessment.js";
import { StartDecidorRole } from "../start/start-decider-role.js";
import { createWizard, isTTY } from "../utils/wizard.js";

// The recommended next step shown for each intent.
const NEXT_STEP = {
  ASSESS_ONLY: "Everything looks healthy — nothing to do.",
  RECOMMEND_HARDEN: "Suggested: `kj harden --interactive`",
  RECOMMEND_INDEX: "Suggested: `kj rag index`",
  START_TASK: 'Suggested: `kj run "<task>"`',
  PROPOSE_PLAN: 'Suggested: `kj plan "<goal>"`',
};

// Each writing intent maps to the saved command + args `kj start` dispatches.
const DISPATCH = {
  RECOMMEND_HARDEN: () => ["harden", "--interactive"],
  RECOMMEND_INDEX: () => ["rag", "index"],
  START_TASK: (task) => ["run", task],
  PROPOSE_PLAN: (task) => ["plan", task],
};

const ASK_FALLBACK = "What would you like to do with this project?";
const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");

// Run a saved `kj` subcommand as a child, inheriting stdio so its own prompts
// (e.g. `harden --interactive`) drive the real terminal. Never throws here.
async function spawnKj(args, { cwd }) {
  await execa("node", [CLI_PATH, ...args.filter(Boolean)], { cwd, stdio: "inherit", reject: false });
}

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

// Ask one yes/no, always closing the readline interface afterwards.
async function confirmApply(makeWizard) {
  const wizard = makeWizard();
  try {
    return await wizard.confirm("Apply this?", true);
  } finally {
    wizard.close();
  }
}

// Print the rationale + recommended step, or the open question for ASK_USER.
function render(result) {
  if (result.intent === "ASK_USER") {
    console.log(`❓ ${result.questionToAsk || ASK_FALLBACK}`);
    return;
  }
  if (result.rationale) console.log(`→ ${result.rationale}`);
  const step = NEXT_STEP[result.intent];
  if (step) console.log(`  ${step}`);
}

export async function startCommand({ task = "", config, logger, flags = {}, deps = {} }) {
  const sweep = deps.runReadOnlySweep || runReadOnlySweep;
  const assess = deps.buildAssessment || buildAssessment;
  const makeDecider = deps.makeDecider || ((opts) => new StartDecidorRole(opts));
  const tty = deps.isTTY || isTTY;
  const spawn = deps.spawnKj || spawnKj;
  const makeWizard = deps.makeWizard || (() => createWizard());

  // KJC-BUG-0145 (campo, #1471): loadConfig never sets projectDir — passing
  // config.projectDir straight through handed `undefined` to the sweep, every
  // collector failed silently and the project read as "new, no source code".
  const projectDir = config.projectDir || process.cwd();
  const bundle = await sweep(projectDir, { declared: flags.maturity || null });
  const { text, summary } = assess(bundle);
  let result = await decide({ task, text, config, logger, makeDecider });

  if (flags.json) {
    console.log(JSON.stringify({ maturity: summary.maturity, assessment: text, ...result }, null, 2));
    return { ok: true, intent: result.intent };
  }

  console.log(`${text}\n`);
  const interactive = tty() && !flags.yes;
  let goal = task;

  // ASK_USER: one interactive re-route — the open answer becomes the goal.
  if (result.intent === "ASK_USER" && interactive) {
    const wizard = makeWizard();
    try {
      const answer = await wizard.input(`❓ ${result.questionToAsk || ASK_FALLBACK}`);
      if (answer) {
        goal = answer;
        result = await decide({ task: answer, text, config, logger, makeDecider });
      }
    } finally {
      wizard.close();
    }
  }
  render(result);

  // Dispatch the chosen intent to its saved command, confirming first (it writes).
  const toArgs = DISPATCH[result.intent];
  if (interactive && toArgs && (await confirmApply(makeWizard))) {
    await spawn(toArgs(goal), { cwd: projectDir });
  }
  return { ok: true, intent: result.intent };
}
