/**
 * KJC-TSK-0879 (issue #1310) — Rulesync compatibility.
 *
 * A Rulesync-managed repo keeps its agent rules in `.rulesync/rules/` and
 * `rulesync generate` compiles them into CLAUDE.md, AGENTS.md, .cursor/rules and
 * the rest, overwriting those files. A block kj writes straight into CLAUDE.md
 * is erased by the next generate, so in such a repo kj writes into Rulesync's
 * source instead, with the same managed markers.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { findManagedBlock } from "./managed-markers.js";
import { hashContent, verifyEntry, withLedger } from "./rulesync-ledger.js";

export const RULESYNC_RULE = join(".rulesync", "rules", "karajan.md");

// Rulesync's own rule frontmatter: not the root overview, applies to every
// target and every file.
const FRONTMATTER = [
  "---",
  "root: false",
  'targets: ["*"]',
  'description: "Karajan Code: method, guidelines and playbook (managed by kj)"',
  'globs: ["**/*"]',
  "---",
  "",
].join("\n");

/** The project uses Rulesync when it has `.rulesync/` or `rulesync.jsonc`. */
export function detectRulesync(projectDir) {
  return existsSync(join(projectDir, ".rulesync")) || existsSync(join(projectDir, "rulesync.jsonc"));
}

/** What a brand-new karajan.md starts with, before kj's managed blocks. */
export const rulesyncRuleSeed = () => FRONTMATTER;

const GENERATE_ARGS = ["generate", "--targets", "*", "--features", "*"];
const defaultRun = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

/**
 * Compile kj's rules out to every agent, only when the project declared
 * `rulesync.generate: true`: kj does not run someone else's compiler on its
 * own. And never a package fetched on the fly: the local binary, or
 * `npx --no-install`. A failure is said out loud and does not break the install.
 */
export function maybeRulesyncGenerate({ projectDir, config, logger = console, run = defaultRun }) {
  if (!detectRulesync(projectDir)) return { ran: false, reason: "no-rulesync" };
  if (config?.rulesync?.generate !== true) {
    logger.info?.(`kj: its rules are in ${RULESYNC_RULE}; run rulesync generate to reach your agents, or declare rulesync.generate: true`);
    return { ran: false, reason: "not-opted-in" };
  }
  const local = join(projectDir, "node_modules", ".bin", "rulesync");
  const [cmd, args] = existsSync(local) ? [local, GENERATE_ARGS] : ["npx", ["--no-install", "rulesync", ...GENERATE_ARGS]];
  try {
    run(cmd, args, projectDir);
    logger.info?.("kj: rulesync generate spread kj's rules to every agent");
    return { ran: true };
  } catch (err) {
    logger.warn?.(`kj: rulesync generate failed (${err.message}); kj's rules are in ${RULESYNC_RULE}, run it yourself`);
    return { ran: false, reason: "failed" };
  }
}

// HU-0002 (ADR 0022, decision 3): kj owns its managed blocks of karajan.md,
// not the file — the team's own rules outside them stay free.
const blockText = (text, blockId) => {
  const block = findManagedBlock(text, blockId);
  return block.found ? text.split("\n").slice(block.startLine, block.endLine + 1).join("\n") : null;
};

/**
 * Write one of kj's blocks of a rulesync rule through the ownership ledger.
 * A block kj wrote before the ledger existed is claimed once, and said; a
 * block edited by hand stops the write — nothing is overwritten.
 */
export function writeRulesyncBlock({ projectDir, file = RULESYNC_RULE, blockId, previous, next, logger = console }) {
  const key = `${relative(".rulesync", file)}#${blockId}`;
  withLedger(projectDir, "kj", (ledger) => {
    const current = previous === null ? null : blockText(previous, blockId);
    const state = current === null ? "absent" : verifyEntry(ledger, key, current);
    if (state === "edited") {
      throw new Error(`${file}: kj's ${blockId} block was edited by hand; kj will not overwrite it. `
        + `Keep it as kj's with kj rulesync adopt ${key}, or hand it to you with kj rulesync release ${key}`);
    }
    if (state === "unowned") logger.info?.(`kj: claimed ${key}, written by kj before the ownership ledger existed`);
    if (next !== previous) {
      mkdirSync(dirname(join(projectDir, file)), { recursive: true });
      writeFileSync(join(projectDir, file), next);
    }
    ledger.entries[key] = { owner: "kj", hash: hashContent(blockText(next, blockId)) };
  });
}
