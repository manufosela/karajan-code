/**
 * kj rules compile (KJC-TSK-0940, MDR-D, ADR 0016): the brief for whoever
 * compiles the rules of the MD files that have no gate yet. kj calls no model:
 * the host agent knows its own tools and their arguments, which is what a
 * condition has to name. It proposes; `kj rules check` proves the proposal and
 * the user approves it (`kj rules approve`, a human act).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import yaml from "js-yaml";

import { shownSource } from "../rules/inventory.js";
import { loadRules, PROPOSAL_FILE, RULES_FILE, rulesCoverage } from "./rules.js";

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

/**
 * KJC-TSK-0953: kj writes the skeleton of the proposal, so nobody retypes the
 * literal texts. It starts from what rules.yml holds minus the stale, lays the
 * proposal already there over it (what is filled in stays), and adds one entry
 * per pending rule that is missing, with no kind yet.
 * @returns {number|null} the entries with no kind, or null when the proposal there is not YAML
 */
function writeSkeleton({ projectDir, home, pending, kept, gone }) {
  const file = path.join(projectDir, PROPOSAL_FILE);
  let proposed = [];
  if (fs.existsSync(file)) {
    try { proposed = yaml.load(fs.readFileSync(file, "utf8"))?.rules; } catch { return null; }
    if (!Array.isArray(proposed)) return null;
  }
  // The approved rules are the base: a proposal that forgot one would remove its
  // gate on approval. What the proposal says about a rule wins; the stale leave.
  const byId = new Map(kept.map((rule) => [rule.id, rule]));
  const loose = []; // entries with no usable id: kept, for kj rules check to name
  for (const entry of proposed) {
    if (typeof entry?.id !== "string") loose.push(entry);
    else if (!gone.has(entry.id)) byId.set(entry.id, entry);
  }
  for (const rule of pending) {
    if (!byId.has(rule.id)) byId.set(rule.id, { id: rule.id, source: shownSource(rule.file, projectDir, home), text: rule.text });
  }
  const rules = [...byId.values(), ...loose];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump({ version: 1, rules }, { lineWidth: -1 }));
  return rules.filter((entry) => !entry?.kind).length;
}

/** @returns {{code: 0|1, lines: string[]}} */
export function rulesCompileBrief({ projectDir, home = os.homedir() }) {
  const covered = rulesCoverage({ projectDir, home });
  if (!covered.output) return covered;
  const pending = covered.output.rows.filter((row) => row.status === "none");
  const { stale } = covered.output;
  if (pending.length + stale.length === 0) return { code: 0, lines: ["✓ every rule of the MD files is decided: nothing to compile"] };
  const gone = new Set(stale.map((rule) => rule.id));
  const kept = loadRules(projectDir).rules.filter((rule) => !gone.has(rule.id));
  const undecided = writeSkeleton({ projectDir, home, pending, kept, gone });
  if (undecided === null) return { code: 1, lines: [`✗ ${PROPOSAL_FILE} is not valid YAML with a rules list: fix it or delete it`] };
  return {
    code: 0,
    lines: [
      "# Compile the rules of the MD files into gates (ADR 0016)",
      "",
      `${PROPOSAL_FILE} is written: what ${RULES_FILE} holds today, as it is, and one entry per rule with no gate,`,
      `with its id, source and literal text. ${undecided} entr${undecided === 1 ? "y has" : "ies have"} no kind yet: edit each one, give it its kind and`,
      `what that kind takes. Leave id, source and text as they are. You propose; you cannot write ${RULES_FILE}.`,
      ...(stale.length ? [`Left out, their text is in no MD any more: ${stale.map((rule) => rule.id).join(", ")}`] : []),
      "",
      FORMAT,
      "",
      ...HOW,
      "",
      "A rule with a condition (deterministic) you write by hand, in its entry. The rest take no condition, and you",
      "decide many at once: `kj rules decide <id>... --kind judgment --tool <tool>` or",
      "`kj rules decide <id>... --kind out-of-scope --reason \"<why no tool call breaks it>\"`.",
      "",
      "## Then",
      "Run `kj rules check` and fix the proposal until it holds. Then run `kj rules review`: a different AI judges",
      "whether each compilation is as strong as its text, and a rule you weakened comes back to you. Only then ask your",
      "user to read it and run `kj rules approve` from their own terminal: no agent session can.",
    ],
  };
}
