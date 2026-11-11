/**
 * Duplicate class members (KJC-TSK-1515) — a slot defined twice in one class
 * keeps only the LAST definition; the first silently stops running. Works on
 * every class (any base or none). A parse failure is never read as clean.
 */
import { parse } from "@babel/parser";
import { plugins } from "./member-reachability.js";

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach((c) => walk(c, visit));
    else if (child && typeof child.type === "string") walk(child, visit);
  }
}

function nameOf(m) {
  if (m.key?.type === "PrivateName") return `#${m.key.id.name}`;
  if (m.computed) return null;
  if (m.key?.type === "Identifier") return m.key.name;
  return /^(String|Numeric)Literal$/.test(m.key?.type) ? String(m.key.value) : null;
}

const accessorKind = (m) => (m.kind === "get" || m.kind === "set" ? m.kind : "other");

/** One getter plus one setter is one property; any other repeat of a slot is a clash. */
function clashes(kinds) {
  if (kinds.length < 2) return false;
  const count = (k) => kinds.filter((x) => x === k).length;
  return !(kinds.length === 2 && count("get") === 1 && count("set") === 1);
}

function duplicatesOf(node) {
  const slots = new Map();
  for (const m of node.body.body) {
    if (m.type === "StaticBlock" || /^TS/.test(m.type)) continue;
    const name = nameOf(m);
    if (name === null) continue;
    const member = `${m.static ? "static " : ""}${name}`;
    const entry = slots.get(member) ?? { member, lines: [], kinds: [] };
    entry.lines.push(m.loc.start.line);
    entry.kinds.push(accessorKind(m));
    slots.set(member, entry);
  }
  return [...slots.values()].filter((e) => clashes(e.kinds)).map(({ member, lines }) => ({ member, lines }));
}

/**
 * @returns {{observable: true, duplicates: Array<{class: string, member: string, lines: number[]}>}
 *   | {observable: false, reason: string}}
 */
export function findDuplicateMembers(source, { file = "<source>" } = {}) {
  let tree;
  try {
    tree = parse(source, { sourceType: "unambiguous", allowReturnOutsideFunction: true, plugins: plugins(file) });
  } catch (err) {
    return { observable: false, reason: `could not be parsed (${err.message}) — not read as clean` };
  }
  const duplicates = [];
  walk(tree.program, (n) => {
    if (n.type !== "ClassDeclaration" && n.type !== "ClassExpression") return;
    const cls = n.id?.name ?? "(anonymous)";
    duplicatesOf(n).forEach((d) => duplicates.push({ class: cls, ...d }));
  });
  return { observable: true, duplicates };
}
