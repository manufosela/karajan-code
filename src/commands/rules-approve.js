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

import { humanActOf } from "../harden/human-act.js";
import { checkVerdict } from "../review/verdict-store.js";
import { approvalView } from "../rules/approval-view.js";
import { loadRules, LOCAL_RULES_FILE, PROPOSAL_FILE, RULES_FILE, rulesCheck } from "./rules.js";


/**
 * @param {{projectDir: string, file?: string, home?: string, env?: object, tty?: boolean,
 *   deps?: {confirm?: Function, ancestry?: object}, log?: (line: string) => void}} opts
 * @returns {Promise<{code: 0|1, lines: string[]}>}
 */
export async function rulesApprove({ projectDir, file = PROPOSAL_FILE, home, env, tty, deps = {}, log = console.log }) {
  const act = humanActOf("rules-approve");
  act.refuse({ env, tty, ancestry: deps.ancestry ?? {} });
  const proposal = path.resolve(projectDir, file);
  let text;
  try { text = fs.readFileSync(proposal, "utf8"); } catch { return { code: 1, lines: [`✗ no ${file}: nothing to approve`] }; }
  const checked = rulesCheck({ projectDir, home, text });
  if (checked.code !== 0) return { code: 1, lines: checked.lines };
  // KJC-TSK-0963: whoever wrote the proposal does not call it good. A different
  // AI must have read these exact bytes; a touched proposal is reviewed again.
  const { ok, verdict } = await checkVerdict(projectDir, text);
  if (!verdict) return { code: 1, lines: ["✗ this proposal has no cross-AI review of its exact content (none recorded, or it changed since): run `kj rules review`"] };
  if (ok) {
    log(`Reviewed by ${verdict.reviewer}, a different AI from the one that wrote it: ${verdict.summary || "approved"}`);
  } else {
    // KJC-TSK-0974 (ADR 0017): a rejection does not decide, the human does. What
    // the defense asks is that nothing weak is approved UNSEEN: objections first.
    log(`REJECTED by ${verdict.reviewer}, a different AI from the one that wrote it: ${verdict.summary || "see its objections"}`);
    log("Its objections, before anything else. Approving installs the proposal as it is, objections included:");
    for (const issue of verdict.issues ?? []) log(`  - ${issue.description ?? issue.message ?? JSON.stringify(issue)}`);
  }
  const { rules, local } = checked;
  // KJC-TSK-0962: read in the order of what can hurt, weakened rules first.
  const view = approvalView(rules, loadRules(projectDir).rules, local, { versioned: RULES_FILE, unversioned: LOCAL_RULES_FILE });
  for (const line of view) log(line);
  act.confirm(deps.confirm);
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
