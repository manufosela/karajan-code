// KJC-TSK-1384 (ADR 0045): `kj gates` lists every rule, fixed and adjustable, with its
// value and who set it. KJC-TSK-1385: `kj gates set` changes an adjustable one.
import path from "node:path";
import { readFileSync } from "node:fs";
import { resolveRules, formatRules, FIXED_RULES, ADJUSTABLE_RULES, parseRuleValue, stricter } from "../gates/registry.js";
import { findQuote, CONTRIBUTING_FILES } from "../gates/contributing.js";
import { loadProjectConfig, writeConfig } from "../config/loader.js";
import { humanAct } from "../harden/human-act.js";
import { signAct } from "../harden/act-sign.js";

// ADR 0018: the full human act, refused to an agent session, then signed by the phone if enrolled.
async function loosenAct({ projectDir, change, kjVersion }) {
  humanAct("gates-loosen");
  await signAct("gates-loosen", {
    projectDir, kjVersion, files: [{ file: ".karajan/kj.config.yml", sha256: "" }],
    changes: [{ file: ".karajan/kj.config.yml", status: "modified", summary: change, diff: change, truncated: false }],
  });
}

/**
 * The agent may tighten; loosening is a human act (ADR 0009), refused to an agent session.
 * @returns {Promise<{rule: string, value: unknown, loosened: boolean}>}
 */
export async function gatesSetCommand({
  rule: id, value: raw, config, project = {}, projectDir = process.cwd(), kjVersion = "unknown",
  load = loadProjectConfig, write = writeConfig, act = loosenAct, print = console.log,
}) {
  if (FIXED_RULES.some((r) => r.id === id)) throw new Error(`${id} is a fixed rule: no one changes it (ADR 0045)`);
  const rule = ADJUSTABLE_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`no adjustable rule "${id}": ${ADJUSTABLE_RULES.map((r) => r.id).join(", ")}`);
  const value = parseRuleValue(rule, raw);
  const current = resolveRules(config, { project }).adjustable.find((r) => r.id === id).value;
  const loosened = value !== current && !stricter(rule, current, value);
  if (loosened) await act({ projectDir, kjVersion, change: `${id}: ${current} → ${value}` });
  const projectConfig = (await load(projectDir)) || {};
  projectConfig.method_gates = { ...projectConfig.method_gates, [rule.key]: value };
  await write(path.join(projectDir, ".karajan", "kj.config.yml"), projectConfig);
  print(`✓ ${id}: ${current} → ${value}${loosened ? " (loosened by you)" : ""}`);
  return { rule: id, value, loosened };
}

/**
 * KJC-TSK-1391: a setting the project's CONTRIBUTING justifies, kept with its sentence, which
 * must be in the file. No human act: the project says it and the quote is checked (ADR 0045).
 * About a fixed rule it changes nothing and is recorded as a conflict, shown to the user.
 */
export async function gatesFromContributingCommand({
  rule: id, value: raw, quote, projectDir = process.cwd(),
  readFile = (rel) => readFileSync(path.join(projectDir, rel), "utf8"),
  load = loadProjectConfig, write = writeConfig, print = console.log,
}) {
  const file = findQuote(quote, readFile);
  if (!file) throw new Error(`that sentence is not in the project's CONTRIBUTING (${CONTRIBUTING_FILES.join(", ")}): nothing changed`);
  const conflict = FIXED_RULES.some((r) => r.id === id);
  const rule = ADJUSTABLE_RULES.find((r) => r.id === id);
  if (!conflict && !rule) throw new Error(`no adjustable rule "${id}": ${ADJUSTABLE_RULES.map((r) => r.id).join(", ")}`);
  const value = conflict ? raw : parseRuleValue(rule, raw);
  const projectConfig = (await load(projectDir)) || {};
  projectConfig.contributing_rules = [...(projectConfig.contributing_rules || []).filter((e) => e.rule !== id), { rule: id, value, quote }];
  await write(path.join(projectDir, ".karajan", "kj.config.yml"), projectConfig);
  print(conflict
    ? `⚠ ${id} is a fixed rule and stays: recorded as a conflict with ${file}, decide whether to use Karajan here`
    : `✓ ${id} → ${value}, from ${file}`);
  return { rule: id, value, file, conflict };
}

export { projectSignals } from "../gates/effective.js";

/** KJC-TSK-1386: only the resolved value of one adjustable rule, for a hook to read. */
export function gatesValueCommand({ rule: id, config, project, print = console.log }) {
  const rule = resolveRules(config, { project }).adjustable.find((r) => r.id === id);
  if (!rule) throw new Error(`no adjustable rule "${id}": ${ADJUSTABLE_RULES.map((r) => r.id).join(", ")}`);
  print(String(rule.value));
  return rule.value;
}

export function gatesCommand({ config, flags = {}, project = {}, conflicts = [], stale = [], print = console.log }) {
  const resolved = { ...resolveRules(config, { project }), conflicts, stale };
  print(flags.json ? JSON.stringify(resolved, null, 2) : formatRules(resolved));
  return resolved;
}
