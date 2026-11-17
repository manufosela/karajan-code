/**
 * One file of agent rules: AGENTS.md (KJC-TSK-1504). Claude Code reads it when
 * the project has no CLAUDE.md, and Gemini CLI once .gemini/settings.json names
 * it. kj no longer writes CLAUDE.md or GEMINI.md: this moves what a person wrote
 * in them into AGENTS.md and removes the old file, so no copy is left to drift.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findManagedBlock } from "../utils/managed-markers.js";

export const AGENTS_FILE = "AGENTS.md";
export const LEGACY_AGENT_FILES = ["CLAUDE.md", "GEMINI.md"];

const OPEN_MARKER = />>> kj:managed:([\w-]+) v\d+ >>>/;

/** What a person wrote in an agent file: everything outside kj's managed blocks. */
export function handWritten(source = "") {
  let lines = source.split("\n");
  for (;;) {
    const id = lines.map((l) => OPEN_MARKER.exec(l)?.[1]).find(Boolean);
    const block = id ? findManagedBlock(lines.join("\n"), id) : { found: false };
    if (!block.found) break;
    lines = [...lines.slice(0, block.startLine), ...lines.slice(block.endLine + 1)];
  }
  return lines.join("\n").trim();
}

const paragraphs = (text) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
// HU-4532: an import of AGENTS.md is the bridge to it, not a rule: it is never moved into AGENTS.md.
const IMPORTS_AGENTS = /^@(?:\.\/)?AGENTS\.md$/;
const withoutAgentsImport = (text) => text.split("\n").filter((line) => !IMPORTS_AGENTS.test(line.trim())).join("\n");

/**
 * Move the hand-written part of CLAUDE.md and GEMINI.md into AGENTS.md (only the
 * paragraphs it does not already hold) and delete the old files. In a Rulesync
 * repo its rule source owns the agent files (KJC-TSK-0879): nothing moves.
 * @returns {{file: string, moved: number}[]} one entry per legacy file found
 */
export function migrateLegacyAgentFiles({ projectDir, dryRun = false, rulesync = false }) {
  if (rulesync) return [];
  const agentsPath = join(projectDir, AGENTS_FILE);
  let agents = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
  const migrated = [];
  for (const file of LEGACY_AGENT_FILES) {
    const legacyPath = join(projectDir, file);
    if (!existsSync(legacyPath)) continue;
    const own = handWritten(readFileSync(legacyPath, "utf8"));
    const rules = paragraphs(withoutAgentsImport(own));
    // A file that only imports AGENTS.md holds no copy that could drift: it stays as it is.
    if (rules.length === 0 && paragraphs(own).length > 0) continue;
    const known = new Set(paragraphs(agents));
    const moved = rules.filter((p) => !known.has(p));
    if (moved.length > 0) {
      const base = agents.trimEnd();
      agents = `${base}${base ? "\n\n" : ""}${moved.join("\n\n")}\n`;
    }
    migrated.push({ file, moved: moved.length });
    if (!dryRun) rmSync(legacyPath);
  }
  if (!dryRun && migrated.some((m) => m.moved > 0)) writeFileSync(agentsPath, agents);
  return migrated;
}
