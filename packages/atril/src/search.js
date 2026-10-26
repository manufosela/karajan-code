/**
 * Lexical search over the store (ADR 0021, decision 5). The index is built
 * from scan(), so it is deterministic: the same store ranks the same way.
 * A query term scores by the field it appears in, the name weighing most
 * and the body least; ties break on kind, then name.
 */
import { availableArtifacts } from "./catalog.js";
import { KINDS } from "./model.js";
import { keyOf, scan } from "./scan.js";

/** The only mode until QMD lands (ADR 0021 plan step 5); always reported. */
export const SEARCH_MODE = "lexical";

const WEIGHTS = { name: 8, keywords: 4, description: 2, body: 1 };
const tokenize = (text) => new Set(String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));

function fieldsOf(artifact) {
  const { keywords = [] } = artifact.atril;
  if (!Array.isArray(keywords) || !keywords.every((k) => typeof k === "string")) {
    throw new Error(`${artifact.path}: atril.keywords must be a list of strings`);
  }
  return {
    name: tokenize(artifact.name),
    keywords: tokenize(keywords.join(" ")),
    description: tokenize(artifact.description),
    body: tokenize(artifact.body),
  };
}

const scoreOf = (fields, terms) =>
  Object.entries(WEIGHTS).reduce((sum, [field, weight]) => sum + weight * terms.filter((term) => fields[field].has(term)).length, 0);

/**
 * The stores' artifacts, and (step 11a) what the catalogs offer, marked `installed: false`
 * with its `catalog`.
 * @param {string} query
 * @param {{ kind?: string, catalogs?: boolean } & Parameters<typeof scan>[0]} [opts] the rest goes to scan()
 * @returns {{ name: string, kind: string, description: string, source: string, installed: boolean, score: number, catalog?: string }[]}
 */
export function search(query, { kind, catalogs: withCatalogs = true, ...scanOpts } = {}) {
  const terms = typeof query === "string" ? [...tokenize(query)] : [];
  if (terms.length === 0) throw new Error("search needs a non-empty query");
  if (kind !== undefined && !KINDS.includes(kind)) throw new Error(`kind ${JSON.stringify(kind)} is not one of ${KINDS.join(", ")}`);
  const { artifacts } = scan(scanOpts);
  const pool = withCatalogs ? [...artifacts, ...availableArtifacts(scanOpts, artifacts)] : artifacts;
  return pool
    .filter((artifact) => kind === undefined || artifact.kind === kind)
    .map((artifact) => ({ artifact, score: scoreOf(fieldsOf(artifact), terms) }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score || (keyOf(a.artifact) < keyOf(b.artifact) ? -1 : 1))
    .map(({ artifact: { name, kind: artifactKind, description, source, catalog }, score }) => ({
      name, kind: artifactKind, description, source, installed: catalog === undefined, score,
      ...(catalog !== undefined && { catalog }),
    }));
}
