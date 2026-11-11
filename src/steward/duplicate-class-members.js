/**
 * Duplicate class members (HU-3831, issue #3604) — grebla's case 1: two
 * `updated()` in one Lit component; the second silently overrode the first and
 * a tab stayed broken for 17 days. Reports a class that declares two members
 * with the same name, kind (method, getter, setter, field) and static-ness.
 * Parsed with @babel/parser, never regexes; read-only over `{files, read}`,
 * so it runs over a history without a checkout or the project's own linter.
 */
import { parseLoose, walk } from "./phantom-coverage.js";

export const MAX_BYTES = 1024 * 1024;
const SOURCE_FILE = /\.(m?[jt]sx?|c[jt]s)$/;

const memberKey = (m) => {
  if (m.computed) return null; // a computed key is not compared
  if (m.key.type === "Identifier") return m.key.name;
  if (m.key.type === "PrivateName") return `#${m.key.id.name}`;
  if (m.key.type === "StringLiteral" || m.key.type === "NumericLiteral") return String(m.key.value);
  return null;
};
const memberKind = (m) => {
  if (m.type === "ClassMethod") return m.kind === "constructor" ? null : m.kind === "get" ? "getter" : m.kind === "set" ? "setter" : "method";
  if (m.type === "ClassProperty" || m.type === "ClassPrivateProperty" || m.type === "ClassAccessorProperty") return "field";
  return null; // TSDeclareMethod (an overload signature), index signatures, static blocks
};

/**
 * @returns {Array<{file: string, className: string, member: string, kind: string, static: boolean, lines: [number, number]}>}
 * @throws when the source does not parse — the caller decides what that means
 */
export function findDuplicateMembers(source, file = "<source>") {
  const found = [];
  walk(parseLoose(source, file), (node) => {
    if (node.type !== "ClassDeclaration" && node.type !== "ClassExpression") return;
    const seen = new Map();
    for (const m of node.body.body) {
      const kind = memberKind(m);
      const name = kind && memberKey(m);
      if (name === null || name === undefined) continue;
      const slot = `${m.static ? "static " : ""}${kind} ${name}`;
      const first = seen.get(slot);
      if (first === undefined) seen.set(slot, m.loc.start.line);
      else found.push({ file, className: node.id?.name ?? "(anonymous)", member: name, kind, static: Boolean(m.static), lines: [first, m.loc.start.line] });
    }
  });
  return found;
}

/**
 * @returns {{duplicates: Array<object>, unparsable: number, skipped: {too_large?: number}}}
 *   an unparsable file is counted, an oversized one is skipped and counted; neither is a finding
 */
export function sweepDuplicateMembers({ files, read }) {
  const result = { duplicates: [], unparsable: 0, skipped: {} };
  for (const file of files.filter((f) => SOURCE_FILE.test(f))) {
    const source = read(file);
    if (source.length > MAX_BYTES) { result.skipped.too_large = (result.skipped.too_large ?? 0) + 1; continue; }
    try { result.duplicates.push(...findDuplicateMembers(source, file)); } catch { result.unparsable += 1; }
  }
  return result;
}
