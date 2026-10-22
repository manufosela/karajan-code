/**
 * Block load (ADR 0021, decisions 5 and 9). Applying one artifact loads it
 * plus the transitive closure of its uses and delegates (author's relations
 * first, then those discovered under `atril:`), each piece after what it
 * depends on. A delegated piece runs as a subagent; related artifacts are
 * only suggested, never loaded. Cycles never reach here: assertGraph
 * rejects them. "Author first" holds within one relation: all uses edges
 * still come before all delegates edges.
 */
import { assertGraph, edgesOf } from "./graph.js";
import { keyOf, scan } from "./scan.js";

const LOADS = ["uses", "delegates"];

/**
 * @param {string} ref the artifact as kind:name
 * @param {Parameters<typeof scan>[0]} [scanOpts]
 * @returns {{ block: { name: string, kind: string, source: string, path: string, content: string, as: "inline" | "subagent" }[],
 *   suggested: { name: string, kind: string, path: string }[] }}
 */
export function resolveBlock(ref, scanOpts = {}) {
  const { artifacts } = scan(scanOpts);
  assertGraph(artifacts);
  const byKey = new Map(artifacts.map((a) => [keyOf(a), a]));
  if (!byKey.has(ref)) throw new Error(`${ref} does not exist`);
  const order = [];
  const seen = new Set();
  const delegated = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const { relation, to } of edgesOf(byKey.get(key)).filter((e) => LOADS.includes(e.relation))) {
      // Deliberate: delegated from any parent makes it a subagent everywhere.
      if (relation === "delegates") delegated.add(to);
      visit(to);
    }
    order.push(key);
  };
  visit(ref);
  const block = order.map((key) => {
    const { name, kind, source, path, body } = byKey.get(key);
    return { name, kind, source, path, content: body, as: delegated.has(key) ? "subagent" : "inline" };
  });
  const related = order.flatMap((key) => edgesOf(byKey.get(key)).filter((e) => e.relation === "related").map((e) => e.to));
  const suggested = [...new Set(related)].filter((key) => !seen.has(key)).map((key) => {
    const { name, kind, path } = byKey.get(key);
    return { name, kind, path };
  });
  return { block, suggested };
}
