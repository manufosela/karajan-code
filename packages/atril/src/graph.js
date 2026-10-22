/**
 * The relation graph (ADR 0021, decision 9). Each artifact's edges are the
 * author's relations plus those atril discovered under `atril:`. A relation
 * to an artifact that does not exist, or a cycle through uses / delegates
 * (block load could never order it), is an error.
 */
import { RELATIONS } from "./model.js";
import { keyOf, scan } from "./scan.js";

/** Typed edges out of one artifact, author's first, deduplicated. */
export const edgesOf = (artifact) =>
  RELATIONS.flatMap((relation) =>
    [...new Set([...artifact[relation], ...(artifact.atril[relation] ?? [])])].map((to) => ({ from: keyOf(artifact), relation, to })),
  );

/** Every missing target and every uses/delegates cycle, as messages. */
export function graphErrors(artifacts) {
  const known = new Set(artifacts.map(keyOf));
  const edges = artifacts.flatMap(edgesOf);
  const errors = edges.filter(({ to }) => !known.has(to)).map((e) => `${e.from} ${e.relation} ${e.to}, which does not exist`);
  const loads = Map.groupBy(edges.filter((e) => ["uses", "delegates"].includes(e.relation) && known.has(e.to)), (e) => e.from);
  const done = new Set();
  const path = [];
  const visit = (node) => {
    if (path.includes(node)) {
      errors.push(`cycle in uses/delegates: ${[...path.slice(path.indexOf(node)), node].join(" -> ")}`);
      return;
    }
    if (done.has(node)) return;
    path.push(node);
    for (const { to } of loads.get(node) ?? []) visit(to);
    done.add(path.pop());
  };
  for (const node of known) visit(node);
  return errors;
}

/** Throw every graph error at once, if there is any. */
export function assertGraph(artifacts) {
  const errors = graphErrors(artifacts);
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

/**
 * The validated graph of the scanned stores, or one artifact's neighbourhood.
 * @param {{ artifact?: string } & Parameters<typeof scan>[0]} [opts] artifact as kind:name
 * @returns {{ nodes: { kind: string, name: string, path: string }[], edges: { from: string, relation: string, to: string }[] }}
 */
export function graph({ artifact, ...scanOpts } = {}) {
  const { artifacts } = scan(scanOpts);
  assertGraph(artifacts);
  if (artifact && !artifacts.some((a) => keyOf(a) === artifact)) throw new Error(`${artifact} does not exist`);
  const edges = artifacts.flatMap(edgesOf).filter((e) => !artifact || e.from === artifact || e.to === artifact);
  const shown = new Set(edges.flatMap((e) => [e.from, e.to]).concat(artifact ?? []));
  const nodes = artifacts.filter((a) => !artifact || shown.has(keyOf(a))).map(({ kind, name, path }) => ({ kind, name, path }));
  return { nodes, edges };
}
