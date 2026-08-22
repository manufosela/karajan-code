/**
 * Duplicate class members (KJC-TSK-0796) — a bug JavaScript refuses to report.
 *
 * Declaring the same member twice in a class is legal: the LAST one wins and the
 * first disappears in silence. No runtime error, no lint warning, no compiler
 * complaint. That is how a `updated()` that loaded the data was lost in GREBLA
 * and a tab stayed empty in production for 17 days.
 *
 * What matters is not that there is a duplicate — it is WHAT WAS LOST: the body
 * that will never run. That is what the finding says.
 *
 * Honest about its limits (the fourth verdict): a file this guard could not read,
 * or one whose member names are computed at runtime, is reported as NOT OBSERVABLE
 * — never as clean.
 */
import { parse } from "@babel/parser";

const plugins = (file) => [
  ...(/\.(ts|tsx|mts|cts)$/.test(file) ? ["typescript"] : []),
  ...(/\.(tsx|jsx)$/.test(file) || !/\.(ts|mts|cts)$/.test(file) ? ["jsx"] : []),
  "decorators",
];
const isClass = (node) => node?.type === "ClassDeclaration" || node?.type === "ClassExpression";

/** Walks every node of the tree; enough for a syntax-only guard (no scope analysis). */
function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(c, visit));
    else if (child && typeof child.type === "string") walk(child, visit);
  }
}

const memberName = (member) => {
  if (member.computed) return null; // `[expr]() {}` — the name is not known until it runs
  const key = member.key ?? member.id;
  if (key?.type === "Identifier") return key.name;
  if (key?.type === "PrivateName") return `#${key.id.name}`;
  if (key?.type === "StringLiteral" || key?.type === "NumericLiteral") return String(key.value);
  return null;
};

/**
 * @param {string} source
 * @param {{file?: string}} [where]
 * @returns {{findings: Array<object>, notObservable: {file: string, reason: string}|null}}
 *   Each finding: {file, className, member, lostLine, winnerLine, message}.
 */
export function findDuplicateMembers(source, { file = "<source>" } = {}) {
  let tree;
  try {
    tree = parse(source, { sourceType: "unambiguous", allowReturnOutsideFunction: true, plugins: plugins(file) });
  } catch (err) {
    return { findings: [], notObservable: { file, reason: `could not be parsed (${err.message}) — not read as clean` } };
  }
  const findings = [];
  let computed = 0;
  walk(tree, (node) => {
    if (!isClass(node)) return;
    const className = node.id?.name ?? "(anonymous)";
    const seen = new Map();
    for (const member of node.body.body) {
      // get/set of the same name are legal, and a static member is a different slot from an
      // instance one — treating either as a duplicate would be the false positive that gets a
      // guard switched off (the credibility rule of KJC-PCS-0082).
      // A TypeScript overload signature (TSDeclareMethod) declares the same name on purpose and
      // carries no body: counting it would flag every overloaded method in the codebase.
      if (member.type === "StaticBlock" || member.type === "TSDeclareMethod" || member.type === "TSIndexSignature" || member.kind === "get" || member.kind === "set") continue;
      const name = memberName(member);
      if (name === null) { computed += 1; continue; }
      const key = `${member.static ? "static " : ""}${name}`;
      const line = member.loc.start.line;
      const first = seen.get(key);
      if (first === undefined) { seen.set(key, line); continue; }
      findings.push({
        file, className, member: key, lostLine: first, winnerLine: line,
        message: `${file}:${line} — ${className}: the ${key} of line ${first} never runs, the one of line ${line} replaces it`,
      });
      seen.set(key, line); // a third copy is reported against the second, not against the first
    }
  });
  const notObservable = computed > 0 && findings.length === 0 ? { file, reason: `${computed} member name(s) computed at runtime — this file cannot be fully checked` } : null;
  return { findings, notObservable };
}
