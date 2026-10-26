/**
 * The recommended set (ADR 0021, decision 13; plan step 12a): what atril ships and offers first,
 * each entry reported as installed and how ("on-demand", or "persistent" when exposed), as
 * "changed" when the installed one differs from this version's, or as "available". "changed"
 * compares the artifact's file (a skill's SKILL.md), not the rest of a skill's folder.
 */
import { readConfig } from "./config.js";
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
  const { expose } = readConfig(opts);
  return scanStore(recommendedDir(opts), "atril:recommended").map((entry) => ({
    kind: entry.kind,
    name: entry.name,
    description: entry.description,
    state: stateOf(entry, held.get(keyOf(entry)), expose[entry.kind]),
  }));
}
