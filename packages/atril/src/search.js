/**
 * Lexical search over the store (ADR 0021, decision 5). The index is built
 * from scan(), so it is deterministic: the same store ranks the same way.
 * A query term scores by the field it appears in, the name weighing most
 * and the body least; a prefix of a token weighs less than an exact match;
 * ties break on kind, then name.
 */
import { availableArtifacts, availablePlugins } from "./catalog.js";
import { KINDS } from "./model.js";
import { keyOf, scan } from "./scan.js";
import { fold } from "./text.js";

/** The only mode until QMD lands (ADR 0021 plan step 5); always reported. */
export const SEARCH_MODE = "lexical";

/** What a hit can be: an artifact kind, or a marketplace plugin (search-only, not an artifact kind). */
const HIT_KINDS = [...KINDS, "plugin"];

const toStderr =({ catalog, entry, reason }) =>
  process.stderr.write(`atril: catalog "${catalog}": ${entry} skipped: ${reason}\n`);

// A plugin is pooled in the artifact shape so that fieldsOf and scoreOf work unchanged.
function pluginHits(opts, onWarning) {
  const { plugins, warnings } = availablePlugins(opts);
  warnings.forEach((warning) => onWarning(warning));
  return plugins.map(({ name, description, catalog }) =>
    ({ name, kind: "plugin", description, source: `catalog:${catalog}`, catalog, atril: {}, body: "" }));
}

const WEIGHTS = { name: 8, keywords: 4, description: 2, body: 1 };
const tokenize = (text) => new Set(fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean));

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

// ADR 0039, layer 2: a term of 4+ chars also matches the tokens it prefixes, at 1/16 of the field's
// weight. Spread over the terms, the prefix share is at most 15/16 (the weights sum to 15, so keep
// PREFIX_SHARE >= 15): an exact match always outranks it. The sums are integers and divide once,
// so equal matches give equal scores and the kind/name tie-break holds.
const PREFIX_MIN = 4;
const PREFIX_SHARE = 16;
const isPrefixOf = (term, tokens) => {
  if ([...term].length < PREFIX_MIN) return false;
  for (const token of tokens) if (token.startsWith(term)) return true;
  return false;
};

function scoreOf(fields, terms) {
  let exact = 0;
  let prefix = 0;
  for (const [field, weight] of Object.entries(WEIGHTS)) {
    for (const term of terms) {
      if (fields[field].has(term)) exact += weight;
      else if (isPrefixOf(term, fields[field])) prefix += weight;
    }
  }
  return exact + Math.round((prefix / (PREFIX_SHARE * terms.length)) * 1e4) / 1e4;
}

/**
 * The stores' artifacts, and (step 11a) what the catalogs offer, marked `installed: false`
 * with its `catalog`. Plugins of marketplace catalogs are hits of kind "plugin" (`plugins: false`
 * leaves them out); a marketplace entry that was skipped goes to `onWarning`, by default to
 * stderr (stdout is MCP's).
 * @param {string} query
 * @param {{ kind?: string, catalogs?: boolean, plugins?: boolean,
 *   onWarning?: (warning: { catalog: string, entry: string, reason: string }) => void }
 *   & Parameters<typeof scan>[0]} [opts] the rest goes to scan()
 * @returns {{ name: string, kind: string, description: string, source: string, installed: boolean, score: number, catalog?: string }[]}
 */
export function search(query, { kind, catalogs: withCatalogs = true, plugins: withPlugins = true, onWarning = toStderr, ...scanOpts } = {}) {
  const terms = typeof query === "string" ? [...tokenize(query)] : [];
  if (terms.length === 0) throw new Error("search needs a non-empty query");
  if (kind !== undefined && !HIT_KINDS.includes(kind)) throw new Error(`kind ${JSON.stringify(kind)} is not one of ${HIT_KINDS.join(", ")}`);
  const { artifacts } = scan(scanOpts);
  const pool = withCatalogs
    ? [...artifacts, ...availableArtifacts(scanOpts, artifacts), ...(withPlugins ? pluginHits(scanOpts, onWarning) : [])]
    : artifacts;
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
