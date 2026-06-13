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

export function installGuidelines({ projectDir = process.cwd(), dryRun = false } = {}) {
  const results = [];
  for (const file of TARGETS) {
    const target = join(projectDir, file);
    const source = existsSync(target) ? readFileSync(target, "utf8") : "";
    const { content, action } = upsertManagedBlock({
      source,
      blockId: "guidelines",
      version: BLOCK_VERSION,
      body: GUIDELINES_BODY,
      style: "html",
    });
    if (!dryRun && action !== "unchanged") writeFileSync(target, content);
    results.push({ file, action });
  }
  return { dryRun, guidelines: results };
}
