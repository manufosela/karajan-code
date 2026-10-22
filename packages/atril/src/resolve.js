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
 *
 * A budget { maxArtifacts, maxTokens } bounds EACH context on its own: the
 * caller's block and every subagent's (decision 9). Tokens are estimated
 * deterministically as ceil(content length / 4). The applied artifact of a
 * context (the subagent itself in its own) always fits or resolve fails
 * naming it; dependencies are cut from the deepest (longest path from the
 * applied one) up, ties in block order, and every cut piece is named in
 * `left`, `for` the caller or the subagent (kind:name) whose context lost it.
 */
import { assertGraph, edgesOf } from "./graph.js";
import { keyOf, scan } from "./scan.js";

const LOADS = ["uses", "delegates"];
const LIMITS = ["maxArtifacts", "maxTokens"];

export const estimateTokens = (content) => Math.ceil(content.length / 4);

function checkBudget(budget) {
  if (typeof budget !== "object" || budget === null || Array.isArray(budget)) throw new Error("budget must be an object");
  const unknown = Object.keys(budget).find((key) => !LIMITS.includes(key));
  if (unknown) throw new Error(`unknown budget limit ${unknown}`);
  for (const limit of LIMITS) {
    const value = budget[limit];
    if (value !== undefined && !(Number.isInteger(value) && value > 0)) throw new Error(`${limit} must be a positive integer`);
  }
}

const overBudget = (pieces, { maxArtifacts = Infinity, maxTokens = Infinity }) =>
  pieces.length > maxArtifacts || pieces.reduce((sum, p) => sum + estimateTokens(p.content), 0) > maxTokens;

const itemOf = ({ name, kind, source, path, body }, as) => ({ name, kind, source, path, content: body, as });

/**
 * @typedef {{ name: string, kind: string, source: string, path: string, content: string,
 *   as: "inline" | "subagent", block?: BlockItem[] }} BlockItem
 * @param {string} ref the artifact as kind:name
 * @param {Parameters<typeof scan>[0]} [scanOpts]
 * @param {{ maxArtifacts?: number, maxTokens?: number }} [budget] unbounded when a limit is absent
 * @returns {{ block: BlockItem[], suggested: { name: string, kind: string, path: string }[],
 *   left: { name: string, path: string, for: string }[] }}
 */
export function resolveBlock(ref, scanOpts = {}, budget = {}) {
  checkBudget(budget);
  const { artifacts } = scan(scanOpts);
  assertGraph(artifacts);
  const byKey = new Map(artifacts.map((a) => [keyOf(a), a]));
  if (!byKey.has(ref)) throw new Error(`${ref} does not exist`);
  const loadsOf = (key) => edgesOf(byKey.get(key)).filter((e) => LOADS.includes(e.relation));
  const blocks = new Map();
  const blockOf = (key) => blocks.get(key) ?? blocks.set(key, contextOf(key).items).get(key);
  const depthOf = new Map();
  const left = [];
  // The context of one artifact: its dependencies, deduplicated per (relation, key) and ordered.
  const contextOf = (root) => {
    const loaded = new Set();
    const entries = [];
    const visit = (key) => {
      for (const { relation, to } of loadsOf(key)) {
        if (loaded.has(`${relation} ${to}`)) continue;
        loaded.add(`${relation} ${to}`);
        if (relation === "delegates") {
          entries.push([to, { ...itemOf(byKey.get(to), "subagent"), block: blockOf(to) }]);
          continue;
        }
        visit(to);
        entries.push([to, itemOf(byKey.get(to), "inline")]);
      }
    };
    visit(root);
    // Reverse postorder is topological: every parent's depth is final first.
    // A subagent's own edges belong to its context, not this one.
    const depth = new Map([[root, 0]]);
    for (const [key, item] of [[root], ...entries.toReversed()]) {
      if (item?.as === "subagent") continue;
      for (const { to } of loadsOf(key)) depth.set(to, Math.max(depth.get(to) ?? 0, depth.get(key) + 1));
    }
    for (const [key, item] of entries) depthOf.set(item, depth.get(key));
    return { items: entries.map(([, item]) => item) };
  };
  // Fit one context, its applied artifact last and never cut, then the
  // contexts of the subagents it keeps.
  const fit = (items, applied, owner) => {
    const kept = [...items, applied];
    const byDepth = items.toSorted((a, b) => depthOf.get(b) - depthOf.get(a));
    while (overBudget(kept, budget)) {
      const piece = byDepth.shift();
      if (!piece) throw new Error(`${applied.kind}:${applied.name} alone exceeds the budget`);
      kept.splice(kept.indexOf(piece), 1);
      left.push({ name: piece.name, path: piece.path, for: owner });
    }
    for (const sub of kept.slice(0, -1).filter((item) => item.block)) {
      sub.block = fit(sub.block, sub, `${sub.kind}:${sub.name}`).slice(0, -1);
    }
    return kept;
  };
  const { items } = contextOf(ref);
  const block = [...items, itemOf(byKey.get(ref), "inline")];
  const inBlock = new Set(block.map(keyOf));
  // Suggestions come from the caller's own context only (ADR 0021, decision 9).
  const own = block.filter((i) => i.as === "inline").map(keyOf);
  const related = own.flatMap((key) => edgesOf(byKey.get(key)).filter((e) => e.relation === "related").map((e) => e.to));
  const suggested = [...new Set(related)].filter((key) => !inBlock.has(key)).map((key) => {
    const { name, kind, path } = byKey.get(key);
    return { name, kind, path };
  });
  return { block: fit(items, block.at(-1), "caller"), suggested, left };
}
