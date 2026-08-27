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
  version: 2, // v2: each list says WHICH slot the framework touches — static and instance are different worlds
  lit: {
    instance: ["constructor", "render", "connectedCallback", "disconnectedCallback", "attributeChangedCallback", "adoptedCallback", "firstUpdated", "updated", "willUpdate", "shouldUpdate", "performUpdate", "getUpdateComplete", "createRenderRoot"],
    static: ["properties", "styles", "observedAttributes"],
  },
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
const ACCESSOR_KINDS = new Map([["get", "getter"], ["set", "setter"]]);
const kindOf = (m) => ACCESSOR_KINDS.get(m.kind) ?? (/Method/.test(m.type) ? "method" : "field");
/** `this.x` / `this['x']` / `this.#x` inside a node, prefixed with the slot the
 * context can actually reach ("static " inside static members, "" otherwise).
 * Over-collecting through functions that rebind `this` only makes members MORE
 * alive — never dead. */
const thisRefs = (node, prefix = "") => {
  const refs = new Set();
  walk(node, (n) => {
    if (n.type !== "MemberExpression" || n.object?.type !== "ThisExpression") return;
    if (n.property.type === "PrivateName") refs.add(`${prefix}#${n.property.id.name}`);
    else if (!n.computed && n.property.type === "Identifier") refs.add(prefix + n.property.name);
    else if (n.property.type === "StringLiteral" || n.property.type === "NumericLiteral") refs.add(prefix + String(n.property.value));
  });
  return refs;
};
const notObs = (name, line, reason) => ({ name, line, observable: false, reason, unreachable: [] });

function analyzeClass(node, { staticUses, thisPropCount }) {
  const name = node.id?.name ?? "(anonymous)";
  const line = node.loc.start.line;
  const sup = node.superClass;
  if (!sup) return notObs(name, line, "no framework contract — members may be called from outside the file");
  if (sup.type !== "Identifier") return notObs(name, line, "mixin or computed base class — inherited entrypoints cannot be resolved");
  const framework = BASES.get(sup.name);
  if (!framework) return notObs(name, line, `unknown base class ${sup.name} — its contract is not in the entrypoint catalog (v${ENTRYPOINT_CATALOG.version})`);

  const cat = ENTRYPOINT_CATALOG[framework];
  const entries = new Set([...cat.instance, ...cat.static.map((s) => `static ${s}`)]);
  const members = new Map(); // slot → { refs, spots, entry }
  // reached at class-definition time (static blocks, static field initializers)
  // or by ClassName.X anywhere in the file — a use is a use, wherever it sits
  const roots = new Set([...(staticUses.get(name) ?? [])].map((s) => `static ${s}`));
  const ctorFields = new Map(); // this._x = v in the constructor: no AST member exists
  for (const m of node.body.body) {
    if (m.type === "StaticBlock") { thisRefs(m, "static ").forEach((r) => roots.add(r)); continue; }
    if (m.type === "TSDeclareMethod" || m.type === "TSIndexSignature") continue;
    if (m.static && /Property/.test(m.type) && m.value) thisRefs(m.value, "static ").forEach((r) => roots.add(r));
    const n = keyName(m);
    if (n === null) return notObs(name, line, `a member name is computed at line ${m.loc.start.line} — the inventory cannot name what it cannot see`);
    const slot = m.static ? `static ${n}` : n;
    const refs = thisRefs(m, m.static ? "static " : "");
    refs.delete(slot); // recursion does not keep itself alive
    const rec = members.get(slot) ?? { refs: new Set(), spots: [], entry: false };
    refs.forEach((r) => rec.refs.add(r));
    rec.spots.push({ line: m.loc.start.line, endLine: m.loc.end.line, kind: kindOf(m) });
    // a decorated member is registered by the framework: it may call or expose it
    if (entries.has(slot) || (m.decorators?.length ?? 0) > 0) rec.entry = true;
    members.set(slot, rec);
    if (n === "constructor" && !m.static) collectCtorAssignments(m, ctorFields);
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
  // HEURISTIC, reported apart (AC5): a constructor field whose name appears in
  // `this.X` form exactly ONCE in the whole file exists only to be initialized.
  const constructorFields = [...ctorFields.entries()]
    .filter(([n]) => !members.has(n) && thisPropCount.get(n) === 1)
    .map(([n, l]) => ({ name: n, line: l, heuristic: "single this-appearance in file" }));
  // memberNames: the class's member slots — phantom-coverage (KJC-TSK-0800)
  // needs to tell "a call to a member of THIS class" from any other call.
  return { name, line, observable: true, reason: null, framework, catalogVersion: ENTRYPOINT_CATALOG.version, total: members.size, memberNames: [...members.keys()], unreachable, constructorFields };
}

/** `this.x = …` statements inside the constructor body (first line wins). */
function collectCtorAssignments(ctor, out) {
  walk(ctor.body, (n) => {
    if (n.type !== "AssignmentExpression" || n.left?.type !== "MemberExpression") return;
    const l = n.left;
    if (l.object?.type !== "ThisExpression" || l.computed || l.property.type !== "Identifier") return;
    if (!out.has(l.property.name)) out.set(l.property.name, n.loc.start.line);
  });
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
  const staticUses = new Map(); // ClassName → Set of properties used as ClassName.X
  const thisPropCount = new Map(); // property → how many `this.X` appearances in the file
  walk(tree, (n) => {
    if (n.type !== "MemberExpression") return;
    if (n.object?.type === "Identifier" && !n.computed && n.property.type === "Identifier") {
      (staticUses.get(n.object.name) ?? staticUses.set(n.object.name, new Set()).get(n.object.name)).add(n.property.name);
    }
    if (n.object?.type !== "ThisExpression") return;
    if (n.computed && n.property.type !== "StringLiteral" && n.property.type !== "NumericLiteral") { dynamic ??= n.loc.start.line; return; }
    if (!n.computed && n.property.type === "Identifier") thisPropCount.set(n.property.name, (thisPropCount.get(n.property.name) ?? 0) + 1);
  });
  if (dynamic !== null) return { file, observable: false, reason: `computed access on this at line ${dynamic} — string dispatch cannot be followed`, classes: [] };

  const classes = [];
  walk(tree, (node) => {
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") classes.push(analyzeClass(node, { staticUses, thisPropCount }));
  });
  return { file, observable: true, reason: null, classes };
}
