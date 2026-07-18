// KJC-TSK-0448 — minimal --where filter parser for metadata-aware RAG
// queries. Grammar (intentionally small):
//
//   clause     := pair ( "AND" pair )*
//   pair       := IDENT "=" VALUE
//   IDENT      := [A-Za-z_][A-Za-z0-9_.-]*
//   VALUE      := unquoted token  | "quoted string"
//
// Examples:
//   symbol=loadConfig
//   hu_id=HU-003 AND kind=plan
//   "headingPath.0"=Architecture
//
// Returns { ok: true, clauses: [["symbol","loadConfig"], ...] } or
// { ok: false, error: "...explanation..." }. The retriever turns each
// clause into a `json_extract(c.metadata, '$.<key>') = ?` SQL fragment;
// the `kind` key is special-cased to filter the column directly.

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function parseWhere(input) {
  if (input == null) return { ok: true, clauses: [] };
  if (typeof input !== "string") return { ok: false, error: "where: input must be a string" };
  const s = input.trim();
  if (!s) return { ok: true, clauses: [] };
  const parts = s.split(/\s+AND\s+/i);
  const clauses = [];
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq <= 0) return { ok: false, error: `where: bad pair "${p}" — expected key=value` };
    const key = p.slice(0, eq).trim().replace(/^"|"$/g, "");
    let val = p.slice(eq + 1).trim();
    if (!IDENT_RE.test(key)) return { ok: false, error: `where: invalid key "${key}"` };
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (val.length === 0) return { ok: false, error: `where: empty value for key "${key}"` };
    clauses.push([key, val]);
  }
  return { ok: true, clauses };
}

/**
 * Build a `(sqlFragment, params)` pair to append to a chunks-table query.
 * `kind` filters the column directly; everything else goes through json_extract.
 */
export function buildWhereSql(clauses) {
  if (!clauses?.length) return { sql: "", params: [] };
  const fragments = [];
  const params = [];
  for (const [k, v] of clauses) {
    if (k === "kind") { fragments.push("c.kind = ?"); params.push(v); }
    else { fragments.push(`json_extract(c.metadata, '$.${k}') = ?`); params.push(v); }
  }
  return { sql: ` AND ${fragments.join(" AND ")}`, params };
}
