/**
 * kj rules approve (KJC-TSK-0952, MDR-D3, ADR 0016): a proposal of compiled rules
 * becomes .karajan/rules.yml only by a HUMAN act, with the layers of the
 * supervisor's seal (ADR 0009). The agent the rules will watch may propose how
 * they are compiled; it does not decide.
 *
 * The proposal is read ONCE: what is checked, what is shown and what is
 * installed are the same rules, whatever happens to the file meanwhile.
 */
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { confirmHuman, refuseAgentSession } from "../harden/human-act.js";
import { loadRules, LOCAL_RULES_FILE, PROPOSAL_FILE, RULES_FILE, rulesCheck } from "./rules.js";

const ACT = "kj rules approve";

/** One rule as the human reads it: what the MD says, and what it was compiled to. */
function shownRule(rule, isLocal) {
  const compiled = rule.kind === "out-of-scope" ? `reason: ${rule.reason}` : `when: ${JSON.stringify(rule.when)}`;
  const where = isLocal ? `${LOCAL_RULES_FILE}, not versioned` : RULES_FILE;
  return `${rule.id}  ${rule.kind}  → ${where}\n    ${rule.text}\n    ${compiled}`;
}

/**
 * @param {{projectDir: string, file?: string, home?: string, env?: object, tty?: boolean,
 *   deps?: {confirm?: Function, ancestry?: object}, log?: (line: string) => void}} opts
 * @returns {{code: 0|1, lines: string[]}}
 */
export function rulesApprove({ projectDir, file = PROPOSAL_FILE, home, env, tty, deps = {}, log = console.log }) {
  refuseAgentSession(ACT, { env, tty, ancestry: deps.ancestry ?? {} });
  const proposal = path.resolve(projectDir, file);
  let text;
  try { text = fs.readFileSync(proposal, "utf8"); } catch { return { code: 1, lines: [`✗ no ${file}: nothing to approve`] }; }
  const checked = rulesCheck({ projectDir, home, text });
  if (checked.code !== 0) return { code: 1, lines: checked.lines };
  const { rules, local } = checked;
  const proposed = new Set(rules.map((rule) => rule.id));
  const leaving = loadRules(projectDir).rules.filter((rule) => !proposed.has(rule.id));
  for (const rule of rules) log(shownRule(rule, local.has(rule.id)));
  for (const rule of leaving) log(`leaves the rules: ${rule.id}  ${rule.text ?? ""}`);
  confirmHuman(ACT, deps.confirm);
  // KJC-TSK-0961 (ADR 0017): a rule written only in the user's private MD files
  // is not versioned. Where it goes is the inventory's word, not the proposal's.
  const parts = [[RULES_FILE, rules.filter((rule) => !local.has(rule.id))], [LOCAL_RULES_FILE, rules.filter((rule) => local.has(rule.id))]];
  for (const [name, part] of parts) {
    const target = path.join(projectDir, name);
    if (part.length) fs.writeFileSync(target, yaml.dump({ version: 1, rules: part }, { lineWidth: -1 }));
    else fs.rmSync(target, { force: true }); // no rule left for this file: none stays behind
  }
  fs.rmSync(proposal, { force: true });
  const [[, versioned], [, kept]] = parts;
  return { code: 0, lines: [`✓ ${versioned.length} rule(s) approved into ${RULES_FILE} (commit it, it travels with the repo) and ${kept.length} into ${LOCAL_RULES_FILE} (not versioned, yours alone)`] };
}
