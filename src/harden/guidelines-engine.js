/**
 * guidelines-engine — seeds AI-agent guideline files for `kj harden`
 * (KJC-TSK-0559), absorbing dev-hooks' generate_guidelines without an external
 * MCP. Writes a kj:managed block into AGENTS.md and CLAUDE.md, preserving any
 * content the user keeps outside the markers. Idempotent.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { upsertManagedBlock } from "../utils/managed-markers.js";
import { GUIDELINES_BODY } from "./guidelines-templates.js";

const BLOCK_VERSION = 1;
const TARGETS = ["AGENTS.md", "CLAUDE.md"];
const DH_START = "<!-- @manufosela/dev-git-hooks:start -->";
const DH_END = "<!-- @manufosela/dev-git-hooks:end -->";

/** Remove a legacy dev-hooks managed block, preserving everything else. */
export function stripDevHooksBlock(source) {
  const s = source.indexOf(DH_START);
  if (s === -1) return { content: source, migrated: false };
  const e = source.indexOf(DH_END, s);
  if (e === -1) return { content: source, migrated: false };
  const before = source.slice(0, s).replace(/\n+$/, "");
  const after = source.slice(e + DH_END.length).replace(/^\n+/, "");
  const joiner = before && after ? "\n\n" : "";
  return { content: `${before}${joiner}${after}`, migrated: true };
}

export function installGuidelines({ projectDir = process.cwd(), dryRun = false } = {}) {
  const results = [];
  for (const file of TARGETS) {
    const target = join(projectDir, file);
    const raw = existsSync(target) ? readFileSync(target, "utf8") : "";
    const { content: source, migrated } = stripDevHooksBlock(raw);
    const { content, action } = upsertManagedBlock({
      source,
      blockId: "guidelines",
      version: BLOCK_VERSION,
      body: GUIDELINES_BODY,
      style: "html",
    });
    if (!dryRun && (migrated || action !== "unchanged")) writeFileSync(target, content);
    results.push({ file, action: migrated ? "migrated" : action });
  }
  return { dryRun, guidelines: results };
}
