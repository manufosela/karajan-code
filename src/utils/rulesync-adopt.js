// HU-0004 (ADR 0022, decision 5): kj init offers rulesync and asks. kj's blocks
// leave the agent files before `rulesync import`, so the import never repeats them.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findManagedBlock } from "./managed-markers.js";
import { ADOPTION_PENDING, defaultRun, detectRulesync, RULESYNC_RULE, rulesyncCommand, rulesyncRuleSeed, writeRulesyncBlock } from "./rulesync.js";

// Each agent file kj writes into, with the rulesync target that imports it.
const AGENT_FILES = [["CLAUDE.md", "claudecode"], ["AGENTS.md", "agentsmd"]];
const KJ_BLOCKS = ["playbook", "guidelines"];
const INSTALL = "npm install --save-dev rulesync";
/** Run one adoption step; on failure, stop naming it and what to run by hand. */
const step = (name, byHand, action) => {
  try {
    action();
  } catch (error) {
    throw new Error(`kj: rulesync adoption stopped at "${name}": ${error.message}\nRun by hand: ${byHand}`, { cause: error });
  }
};

/** Split kj's block out of `text`: its lines, and the text without them. */
const takeBlock = (text, blockId) => {
  const block = findManagedBlock(text, blockId);
  if (!block.found) return { block: null, rest: text };
  const lines = text.split("\n");
  return {
    block: lines.slice(block.startLine, block.endLine + 1).join("\n"),
    rest: [...lines.slice(0, block.startLine), ...lines.slice(block.endLine + 1)].join("\n"),
  };
};

/** Move kj's blocks from the agent files into its ledger-owned rule. */
function moveKjBlocks(projectDir) {
  const paths = AGENT_FILES.map(([file]) => join(projectDir, file)).filter((path) => existsSync(path));
  const texts = new Map(paths.map((path) => [path, readFileSync(path, "utf8")]));
  for (const blockId of KJ_BLOCKS) {
    let moved = null;
    for (const [path, text] of texts) {
      const { block, rest } = takeBlock(text, blockId);
      moved ??= block; // first copy wins: harden re-renders the block anyway
      texts.set(path, rest);
    }
    if (moved === null) continue;
    writeRulesyncBlock({
      projectDir, blockId,
      // A resumed adoption may find the block already here: replace it, never repeat it.
      render: (previous) => ({ content: `${takeBlock(previous ?? rulesyncRuleSeed(), blockId).rest.replace(/\n*$/, "\n")}${moved}\n` }),
    });
  }
  for (const [path, text] of texts) writeFileSync(path, text);
}

/** Adopt rulesync: init, kj's blocks to its rule, then import what the agent files keep. */
function adoptRulesync({ projectDir, logger, run }) {
  const exec = (args) => run(...rulesyncCommand(projectDir, args), projectDir);
  try {
    exec(["--version"]);
  } catch {
    logger.warn(`kj: rulesync is not installed, so it was not adopted. Install it with: ${INSTALL}, then run kj init again`);
    return { adopted: false, reason: "not-installed" };
  }
  const execStep = (args) => {
    const [cmd, fullArgs] = rulesyncCommand(projectDir, args);
    step(`rulesync ${args.join(" ")}`, `${[cmd, ...fullArgs].join(" ")}, then kj init to finish it`, () => run(cmd, fullArgs, projectDir));
  };
  mkdirSync(join(projectDir, ".rulesync"), { recursive: true });
  writeFileSync(join(projectDir, ADOPTION_PENDING), "kj init: rulesync adoption in progress\n");
  execStep(["init"]);
  step(`move kj's blocks into ${RULESYNC_RULE}`, `fix ${RULESYNC_RULE} or kj's blocks in CLAUDE.md/AGENTS.md, then kj init`, () => moveKjBlocks(projectDir));
  for (const [file, target] of AGENT_FILES) {
    if (existsSync(join(projectDir, file))) execStep(["import", "--targets", target]);
  }
  rmSync(join(projectDir, ADOPTION_PENDING));
  logger.info(`kj: rulesync adopted; kj's rules now live in ${RULESYNC_RULE}`);
  return { adopted: true };
}

/**
 * Ask whether to adopt rulesync. `flags.rulesync` (--rulesync / --no-rulesync)
 * answers without asking; with no TTY and no flag, nothing is adopted.
 */
export async function offerRulesyncAdoption({ projectDir, flags = {}, interactive, confirm, logger = console, run = defaultRun }) {
  if (detectRulesync(projectDir)) return { adopted: false, reason: "already" };
  const halfDone = existsSync(join(projectDir, ADOPTION_PENDING));
  const verb = halfDone ? "finish the half-done adoption" : "adopt it";
  if (flags.rulesync === undefined && !interactive) {
    logger.info(`kj: rulesync not adopted (nobody to ask); pass --rulesync to ${verb}, or --no-rulesync to keep the agent files`);
    return { adopted: false, reason: "no-answer" };
  }
  const question = halfDone
    ? "Finish adopting rulesync? A previous kj init stopped halfway (rulesync init + import)"
    : "Adopt rulesync? One source in .rulesync/ for every agent's rules (rulesync init + import)";
  const answer = flags.rulesync ?? await confirm(question);
  if (answer !== true) return { adopted: false, reason: "declined" };
  return adoptRulesync({ projectDir, logger, run });
}
