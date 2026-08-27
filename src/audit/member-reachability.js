/**
 * Member reachability (KJC-TSK-0794, epic KJC-PCS-0082) — which class members
 * no entrypoint can reach, said ONLY inside the perimeter validated with known
 * truth (GREBLA: 31/139 unreachable at dd5a91a checked by hand, 0/108 on their
 * cleaned main): one file, a recognized framework contract, no dynamic dispatch.
 * Everything outside comes out NOT OBSERVABLE with its reason, never as clean —
 * an inflated inventory gets switched off, and then nobody reads the real one.
 */
import { parse } from "@babel/parser";
const plugins = (file) => [
  ...(/\.(ts|tsx|mts|cts)$/.test(file) ? ["typescript"] : []),
  ...(/\.(tsx|jsx)$/.test(file) || !/\.(ts|mts|cts)$/.test(file) ? ["jsx"] : []),
  "decorators",
];
// Entrypoints are what the FRAMEWORK calls — declared per framework, VERSIONED
// (bump on any list change), never a hand-kept list in a run. v1 covers Lit;
// other frameworks stay NOT OBSERVABLE until their contract is declared here.
export const ENTRYPOINT_CATALOG = {
  version: 1,
  lit: ["constructor", "render", "connectedCallback", "disconnectedCallback", "attributeChangedCallback", "adoptedCallback", "firstUpdated", "updated", "willUpdate", "shouldUpdate", "performUpdate", "getUpdateComplete", "createRenderRoot", "properties", "styles", "observedAttributes"],
};
const BASES = new Map([["LitElement", "lit"]]);
function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(c, visit));
    else if (child && typeof child.type === "string") walk(child, visit);
  }
}
const keyName = (m) => {
  if (m.key?.type === "PrivateName") return `#${m.key.id.name}`;
  if (!m.computed && m.key?.type === "Identifier") return m.key.name;
  return m.key?.type === "StringLiteral" || m.key?.type === "NumericLiteral" ? String(m.key.value) : null;
};
const kindOf = (m) => (m.kind === "get" ? "getter" : m.kind === "set" ? "setter" : /Method/.test(m.type) ? "method" : "field");
/** `this.x` / `this['x']` / `this.#x` inside a node. Over-collecting through
 * functions that rebind `this` only makes members MORE alive — never dead. */
const thisRefs = (node) => {
  const refs = new Set();
  walk(node, (n) => {
    if (n.type !== "MemberExpression" || n.object?.type !== "ThisExpression") return;
    if (n.property.type === "PrivateName") refs.add(`#${n.property.id.name}`);
    else if (!n.computed && n.property.type === "Identifier") refs.add(n.property.name);
    else if (n.property.type === "StringLiteral" || n.property.type === "NumericLiteral") refs.add(String(n.property.value));
  });
  return refs;
};
const notObs = (name, line, reason) => ({ name, line, observable: false, reason, unreachable: [] });

function analyzeClass(node) {
  const name = node.id?.name ?? "(anonymous)";
  const line = node.loc.start.line;
  const sup = node.superClass;
  if (!sup) return notObs(name, line, "no framework contract — members may be called from outside the file");
  if (sup.type !== "Identifier") return notObs(name, line, "mixin or computed base class — inherited entrypoints cannot be resolved");
  const framework = BASES.get(sup.name);
  if (!framework) return notObs(name, line, `unknown base class ${sup.name} — its contract is not in the entrypoint catalog (v${ENTRYPOINT_CATALOG.version})`);

  const entries = new Set(ENTRYPOINT_CATALOG[framework]);
  const members = new Map(); // name → { refs, spots, entry }
  const roots = new Set(); // reached at class-definition time (static blocks)
  for (const m of node.body.body) {
    if (m.type === "StaticBlock") { thisRefs(m).forEach((r) => roots.add(r)); continue; }
    if (m.type === "TSDeclareMethod" || m.type === "TSIndexSignature") continue;
    // a static field INITIALIZER also runs at class-definition time
    if (m.static && /Property/.test(m.type) && m.value) thisRefs(m.value).forEach((r) => roots.add(r));
    const n = keyName(m);
    if (n === null) return notObs(name, line, `a member name is computed at line ${m.loc.start.line} — the inventory cannot name what it cannot see`);
    const refs = thisRefs(m);
    refs.delete(n); // recursion does not keep itself alive
    const rec = members.get(n) ?? { refs: new Set(), spots: [], entry: false };
    refs.forEach((r) => rec.refs.add(r));
    rec.spots.push({ line: m.loc.start.line, endLine: m.loc.end.line, kind: kindOf(m) });
    // a decorated member is registered by the framework: it may call or expose it
    if (entries.has(n) || (m.decorators?.length ?? 0) > 0) rec.entry = true;
    members.set(n, rec);
  }

  const alive = new Set();
  const queue = [...members.keys()].filter((k) => members.get(k).entry || roots.has(k));
  while (queue.length) {
    const k = queue.pop();
    if (alive.has(k) || !members.has(k)) continue;
    alive.add(k);
    members.get(k).refs.forEach((r) => { if (members.has(r) && !alive.has(r)) queue.push(r); });
  }
  const unreachable = [...members.entries()]
    .filter(([k]) => !alive.has(k))
    .flatMap(([k, rec]) => rec.spots.map((s) => ({ name: k, ...s })))
    .sort((a, b) => a.line - b.line);
  return { name, line, observable: true, reason: null, framework, catalogVersion: ENTRYPOINT_CATALOG.version, total: members.size, unreachable };
}

/**
 * @param {string} source
 * @param {{file?: string}} [where]
 * @returns {{file: string, observable: boolean, reason: string|null, classes: Array<object>}}
 */
export function analyzeMemberReachability(source, { file = "<source>" } = {}) {
  let tree;
  try {
    tree = parse(source, { sourceType: "unambiguous", allowReturnOutsideFunction: true, plugins: plugins(file) });
  } catch (err) {
    return { file, observable: false, reason: `could not be parsed (${err.message}) — not read as clean`, classes: [] };
  }
  // String dispatch is the most dangerous false positive: ONE computed access
  // on `this` that is not a literal makes the whole file not observable — a
  // list with garbage is worth less than an honest "I do not know".
  let dynamic = null;
  walk(tree, (n) => {
    if (dynamic !== null || n.type !== "MemberExpression" || !n.computed || n.object?.type !== "ThisExpression") return;
    if (n.property.type !== "StringLiteral" && n.property.type !== "NumericLiteral") dynamic = n.loc.start.line;
  });
  if (dynamic !== null) return { file, observable: false, reason: `computed access on this at line ${dynamic} — string dispatch cannot be followed`, classes: [] };

  const classes = [];
  walk(tree, (node) => {
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") classes.push(analyzeClass(node));
  });
  return { file, observable: true, reason: null, classes };
}
