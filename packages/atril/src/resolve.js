/**
 * Block load (ADR 0021, decisions 5 and 9). Applying one artifact loads it
 * plus the transitive closure of its uses (author's relations first, then
 * those discovered under `atril:`), plus any agent delegated along the way,
 * each piece after what it depends on, the applied artifact last. A subagent's dependencies travel with it: a
 * delegated agent is ONE item, `as: "subagent"`, carrying its content and its
 * own `block` (its uses and delegates resolved the same way, recursively);
 * none of it enters the caller's block unless the caller uses it too. E.g.
 * ship (uses style, delegates tester; tester uses tdd) resolves to
 * [style, tester { as: "subagent", block: [base, tdd] }, ship]. Related artifacts
 * are only suggested, never loaded. Cycles never reach here: assertGraph
 * rejects them. Within one artifact, uses edges come before delegates edges.
 * An agent both used and delegated in one context appears once as each.
 */
import { assertGraph, edgesOf } from "./graph.js";
import { keyOf, scan } from "./scan.js";

const LOADS = ["uses", "delegates"];

const itemOf = ({ name, kind, source, path, body }, as) => ({ name, kind, source, path, content: body, as });

/**
 * @typedef {{ name: string, kind: string, source: string, path: string, content: string,
 *   as: "inline" | "subagent", block?: BlockItem[] }} BlockItem
 * @param {string} ref the artifact as kind:name
 * @param {Parameters<typeof scan>[0]} [scanOpts]
 * @returns {{ block: BlockItem[], suggested: { name: string, kind: string, path: string }[] }}
 */
export function resolveBlock(ref, scanOpts = {}) {
  const { artifacts } = scan(scanOpts);
  assertGraph(artifacts);
  const byKey = new Map(artifacts.map((a) => [keyOf(a), a]));
  if (!byKey.has(ref)) throw new Error(`${ref} does not exist`);
  const blocks = new Map();
  const blockOf = (key) => blocks.get(key) ?? blocks.set(key, contextOf(key).items).get(key);
  // The context of one artifact: its dependencies, deduplicated per (relation, key) and ordered.
  const contextOf = (root) => {
    const seen = new Set([root]);
    const loaded = new Set();
    const items = [];
    const visit = (key) => {
      for (const { relation, to } of edgesOf(byKey.get(key)).filter((e) => LOADS.includes(e.relation))) {
        if (loaded.has(`${relation} ${to}`)) continue;
        loaded.add(`${relation} ${to}`);
        seen.add(to);
        if (relation === "delegates") {
          items.push({ ...itemOf(byKey.get(to), "subagent"), block: blockOf(to) });
          continue;
        }
        visit(to);
        items.push(itemOf(byKey.get(to), "inline"));
      }
    };
    visit(root);
    return { items, seen };
  };
  const { items, seen } = contextOf(ref);
  // Suggestions come from the caller's own context only (ADR 0021, decision 9).
  const own = [ref, ...items.filter((i) => i.as === "inline").map(keyOf)];
  const related = own.flatMap((key) => edgesOf(byKey.get(key)).filter((e) => e.relation === "related").map((e) => e.to));
  const suggested = [...new Set(related)].filter((key) => !seen.has(key)).map((key) => {
    const { name, kind, path } = byKey.get(key);
    return { name, kind, path };
  });
  return { block: [...items, itemOf(byKey.get(ref), "inline")], suggested };
}
