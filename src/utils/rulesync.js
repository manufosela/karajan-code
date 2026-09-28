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
import { existsSync } from "node:fs";
import { join } from "node:path";

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
