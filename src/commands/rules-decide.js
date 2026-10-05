/**
 * kj rules decide (KJC-TSK-0969, MDR-G, ADR 0016): a real project has more than
 * a hundred rules, and most take no condition. Their kind is decided in one go:
 * judgment with the tool it shows on, or out of scope with the reason. kj writes
 * the proposal, as it writes its skeleton. A deterministic rule is not decided
 * here: its condition and its examples are written rule by rule.
 */
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { PROPOSAL_FILE } from "./rules.js";

const failed = (line) => ({ code: 1, lines: [`✗ ${line}`] });

/** What each kind takes, or why it cannot be decided this way. */
function decision({ kind, tools = [], reason = "" }) {
  if (kind === "judgment") {
    if (tools.length === 0) return { error: "a judgment rule names the tool it shows on: --tool <glob> (repeatable)" };
    return { fields: { kind, when: { tool: tools.length === 1 ? tools[0] : tools } } };
  }
  if (kind === "out-of-scope") {
    if (!reason.trim()) return { error: "an out-of-scope rule says why no tool call breaks it: --reason <text>" };
    return { fields: { kind, reason: reason.trim() } };
  }
  return { error: "--kind is judgment or out-of-scope; a deterministic rule is written by hand, with its condition and its examples" };
}

/**
 * @param {{projectDir: string, file?: string, ids: string[], kind: string, tools?: string[], reason?: string}} opts
 * @returns {{code: 0|1, lines: string[]}}
 */
export function rulesDecide({ projectDir, file = PROPOSAL_FILE, ids, kind, tools, reason }) {
  if (!Array.isArray(ids) || ids.length === 0) return failed("name at least one rule id (R-...)");
  const { fields, error } = decision({ kind, tools, reason });
  if (error) return failed(error);
  const target = path.resolve(projectDir, file);
  let doc;
  try { doc = yaml.load(fs.readFileSync(target, "utf8")); } catch { return failed(`no readable ${file}: run \`kj rules compile\` first`); }
  if (!Array.isArray(doc?.rules)) return failed(`${file} has no rules list`);
  const wanted = new Set(ids);
  const known = new Set(doc.rules.map((entry) => entry?.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) return failed(`not in ${file}: ${missing.join(", ")}`);
  // What identifies the rule stays; what its previous kind took goes.
  doc.rules = doc.rules.map((entry) => (wanted.has(entry?.id) ? { id: entry.id, source: entry.source, text: entry.text, ...fields } : entry));
  fs.writeFileSync(target, yaml.dump(doc, { lineWidth: -1 }));
  const undecided = doc.rules.filter((entry) => !entry?.kind).length;
  return { code: 0, lines: [`✓ ${wanted.size} rule(s) decided as ${kind}; ${undecided} entr${undecided === 1 ? "y has" : "ies have"} no kind yet`] };
}
