/**
 * KJC-TSK-0879 (issue #1310) — Rulesync compatibility.
 *
 * A Rulesync-managed repo keeps its agent rules in `.rulesync/rules/` and
 * `rulesync generate` compiles them into CLAUDE.md, AGENTS.md, .cursor/rules and
 * the rest, overwriting those files. A block kj writes straight into CLAUDE.md
 * is erased by the next generate, so in such a repo kj writes into Rulesync's
 * source instead, with the same managed markers.
 */
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
