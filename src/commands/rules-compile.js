/**
 * kj rules compile (KJC-TSK-0940, MDR-D, ADR 0016): the brief for whoever
 * compiles the rules of the MD files that have no gate yet. kj calls no model:
 * the host agent knows its own tools and their arguments, which is what a
 * condition has to name. It proposes; `kj rules check` proves the proposal and
 * the user approves it (`kj rules approve`, a human act).
 */
import os from "node:os";
import path from "node:path";

import { PROPOSAL_FILE, RULES_FILE, rulesCoverage } from "./rules.js";

const FORMAT = `\`\`\`yaml
version: 1
rules:
  - id: R-0a1b2c3d4e          # the id below, as is
    source: CLAUDE.md          # the MD file the rule is written in
    text: "Sprints: uno por día."   # the rule's text, word for word
    kind: deterministic
    when:                      # WHEN TO DENY the call
      tool: "mcp__planning-game*__create_sprint"   # a glob, or a list of globs
      any:                     # all: every condition holds; any: at least one
        - { arg: allowLongSprint, equals: true }
        - { arg: endDate, days_from: startDate, gt: 0 }
    message: "Un sprint dura un día."   # what the denied agent reads
    examples:                  # the rule is run against them: both lists required
      deny: [{ tool: mcp__planning-game-x__create_sprint, input: { startDate: "2026-10-05", endDate: "2026-10-11" } }]
      allow: [{ tool: mcp__planning-game-x__create_sprint, input: { startDate: "2026-10-05", endDate: "2026-10-05" } }]
  - { id: R-1a2b3c4d5e, source: CLAUDE.md, text: "No preguntes obviedades.", kind: judgment, when: { tool: AskUserQuestion } }
  - { id: R-2a3b4c5d6e, source: CLAUDE.md, text: "Habla español correcto.", kind: out-of-scope, reason: "no tool call breaks it" }
\`\`\``;

const HOW = [
  "A condition reads ONE argument of the tool input (`arg`, a dotted path such as updates.status) with exactly one",
  "operator: equals, in (a list), matches (a regex), exists (true/false), gt, lt. With days_from, gt/lt compare the",
  "calendar days from that other argument to `arg`. There is nothing else: no other keys, no free code.",
  "",
  "Choose the kind of each rule:",
  "- deterministic: ONE tool call breaks it and the tool name and its arguments are enough to tell. Name the tools",
  "  as you see them (MCP tools included). Deny only what the rule forbids: a gate that denies honest calls gets removed.",
  "- judgment: a tool call breaks it, but telling takes reading what the call says. Give `when.tool` only.",
  "- out-of-scope: it is about how you think or answer, and no tool call breaks it. Give the `reason`.",
  "Do not stretch a rule into a condition it does not state, and do not leave a rule out: every rule gets a kind.",
];

/** A source as it can be written in a versioned file: inside the project, or from `~`. */
const shownSource = (file, projectDir, home) => {
  const inProject = path.relative(projectDir, file);
  if (!inProject.startsWith("..") && !path.isAbsolute(inProject)) return inProject;
  const fromHome = path.relative(home, file);
  return fromHome.startsWith("..") || path.isAbsolute(fromHome) ? file : path.join("~", fromHome);
};

/** @returns {{code: 0|1, lines: string[]}} */
export function rulesCompileBrief({ projectDir, home = os.homedir() }) {
  const covered = rulesCoverage({ projectDir, home });
  if (!covered.output) return covered;
  const pending = covered.output.rows.filter((row) => row.status === "none");
  const { stale } = covered.output;
  if (pending.length + stale.length === 0) return { code: 0, lines: ["✓ every rule of the MD files is decided: nothing to compile"] };
  return {
    code: 0,
    lines: [
      `# Compile ${pending.length} rule(s) of the MD files into gates (ADR 0016)`,
      "",
      `Write the whole new rule set to ${PROPOSAL_FILE}. You propose; you cannot write ${RULES_FILE}.`,
      `Start from the entries ${RULES_FILE} already has, as they are, and add one entry per rule listed below.`,
      ...(stale.length ? [`Their text is in no MD any more, drop them: ${stale.map((rule) => rule.id).join(", ")}`] : []),
      "",
      FORMAT,
      "",
      ...HOW,
      "",
      "## Rules with no gate",
      ...pending.flatMap((rule) => [`${rule.id}  ${shownSource(rule.file, projectDir, home)}:${rule.line}`, `    ${rule.text}`]),
      "",
      "## Then",
      "Run `kj rules check` and fix the proposal until it holds. Then ask your user to read it and run",
      "`kj rules approve` from their own terminal: no agent session can.",
    ],
  };
}
