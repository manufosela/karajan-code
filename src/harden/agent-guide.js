/**
 * HU-4574: the guide an agent reads to work with Karajan, installed as a Claude Code skill of the
 * project. kj owns the copy it wrote (the managed mark) and refreshes it; one written by hand stays.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getTemplatesRoot } from "../utils/templates-root.js";

export const AGENT_GUIDE = ".claude/skills/working-with-karajan/SKILL.md";
const MANAGED = "<!-- kj:managed:working-with-karajan -->";

/** @returns {{file: string, action: string, note?: string}[]} one entry, as the guidelines report them */
export function agentGuide(projectDir, dryRun = false, templatesRoot = getTemplatesRoot()) {
  const body = readFileSync(join(templatesRoot, "agent-guide", "SKILL.md"), "utf8");
  const target = join(projectDir, AGENT_GUIDE);
  const now = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (now === body) return [{ file: AGENT_GUIDE, action: "unchanged" }];
  if (now !== null && !now.includes(MANAGED)) return [{ file: AGENT_GUIDE, action: "skipped", note: "written by hand: kj leaves it" }];
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return [{ file: AGENT_GUIDE, action: now === null ? "created" : "updated" }];
}
