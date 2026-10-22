// HU-0004 (ADR 0022, decision 5): kj init offers rulesync and asks. kj's blocks
// leave the agent files before `rulesync import`, so the import never repeats them.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findManagedBlock } from "./managed-markers.js";
import { defaultRun, detectRulesync, RULESYNC_RULE, rulesyncCommand, rulesyncRuleSeed, writeRulesyncBlock } from "./rulesync.js";

// Each agent file kj writes into, with the rulesync target that imports it.
const AGENT_FILES = [["CLAUDE.md", "claudecode"], ["AGENTS.md", "agentsmd"]];
const KJ_BLOCKS = ["playbook", "guidelines"];
const INSTALL = "npm install --save-dev rulesync";

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
      moved ??= block;
      texts.set(path, rest);
    }
    if (moved === null) continue;
    writeRulesyncBlock({
      projectDir, blockId,
      render: (previous) => ({ content: `${(previous ?? rulesyncRuleSeed()).replace(/\n*$/, "\n")}${moved}\n` }),
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
  exec(["init"]);
  moveKjBlocks(projectDir);
  for (const [file, target] of AGENT_FILES) {
    if (existsSync(join(projectDir, file))) exec(["import", "--targets", target]);
  }
  logger.info(`kj: rulesync adopted; kj's rules now live in ${RULESYNC_RULE}`);
  return { adopted: true };
}

/**
 * Ask whether to adopt rulesync. `flags.rulesync` (--rulesync / --no-rulesync)
 * answers without asking; with no TTY and no flag, nothing is adopted.
 */
export async function offerRulesyncAdoption({ projectDir, flags = {}, interactive, confirm, logger = console, run = defaultRun }) {
  if (detectRulesync(projectDir)) return { adopted: false, reason: "already" };
  if (flags.rulesync === undefined && !interactive) {
    logger.info("kj: rulesync not adopted (nobody to ask); pass --rulesync to adopt it, or --no-rulesync to keep the agent files");
    return { adopted: false, reason: "no-answer" };
  }
  const answer = flags.rulesync ?? await confirm("Adopt rulesync? One source in .rulesync/ for every agent's rules (rulesync init + import)");
  if (answer !== true) return { adopted: false, reason: "declined" };
  return adoptRulesync({ projectDir, logger, run });
}
