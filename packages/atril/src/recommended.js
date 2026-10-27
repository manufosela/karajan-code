/**
 * The recommended set (ADR 0021, decision 13; plan step 12a): what atril ships and offers first,
 * each entry reported as installed and how ("on-demand", or "persistent" when exposed), as
 * "changed" when the installed one differs from this version's, or as "available". "changed"
 * compares the artifact's file (a skill's SKILL.md), not the rest of a skill's folder.
 */
import { expose, unexpose } from "./bridge.js";
import { installFromCatalog } from "./catalog-install.js";
import { readConfig } from "./config.js";
import { isMapping } from "./model.js";
import { recommendedDir } from "./catalog.js";
import { keyOf, scan, scanStore } from "./scan.js";

function stateOf(entry, installed, exposed) {
  if (!installed) return "available";
  // The hash ignores atril's own enrichment, so an enriched copy is not "changed".
  if (installed.hash !== entry.hash) return "changed";
  return exposed.includes(entry.name) ? "persistent" : "on-demand";
}

/**
 * @param {{ projectDir?: string, root?: string, userRoot?: string, env?: object, recommended?: string }} [opts]
 * @returns {{ kind: string, name: string, description: string, state: "available" | "on-demand" | "persistent" | "changed" }[]}
 */
export function recommended(opts = {}) {
  const held = new Map(scan(opts).artifacts.map((artifact) => [keyOf(artifact), artifact]));
  const { expose: exposed } = readConfig(opts);
  return scanStore(recommendedDir(opts), "atril:recommended").map((entry) => ({
    kind: entry.kind,
    name: entry.name,
    description: entry.description,
    state: stateOf(entry, held.get(keyOf(entry)), exposed[entry.kind]),
  }));
}

const ANSWERS = ["skip", "on-demand", "persistent"];

/**
 * Apply answers already decided (plan step 12b), without asking: "on-demand" installs the entry
 * from the recommended set (and takes it out of expose), "persistent" also exposes it, "skip"
 * leaves it as it is, even a "changed" one. Every answer is validated before any is applied; an
 * install that still fails leaves the ones before it installed, and applying again resumes. An
 * installed entry is not reinstalled, and a "changed" one is left untouched (content and
 * exposure alike) and reported in `changed`.
 * @param {Record<string, "skip" | "on-demand" | "persistent">} answers keyed by kind:name
 * @param {Parameters<typeof recommended>[0]} [opts]
 * @returns {{ installed: string[], exposed: string[], skipped: string[], changed: string[] }}
 */
export function applyRecommended(answers, opts = {}) {
  if (!isMapping(answers)) throw new Error("answers must be an object of kind:name to skip, on-demand or persistent");
  const states = new Map(recommended(opts).map((entry) => [keyOf(entry), entry.state]));
  for (const [key, answer] of Object.entries(answers)) {
    if (!states.has(key)) throw new Error(`${key} is not in the recommended set`);
    if (!ANSWERS.includes(answer)) throw new Error(`${key}: ${JSON.stringify(answer)} is not one of ${ANSWERS.join(", ")}`);
  }
  const result = { installed: [], exposed: [], skipped: [], changed: [] };
  const retracted = [];
  for (const [key, answer] of Object.entries(answers)) {
    if (answer === "skip") result.skipped.push(key);
    else if (states.get(key) === "changed") result.changed.push(key);
    else {
      if (states.get(key) === "available") installFromCatalog(key, opts);
      result.installed.push(key);
      if (answer === "persistent") result.exposed.push(key);
      else if (states.get(key) === "persistent") retracted.push(key);
    }
  }
  if (result.exposed.length > 0) expose(result.exposed, opts);
  if (retracted.length > 0) unexpose(retracted, opts);
  return result;
}
