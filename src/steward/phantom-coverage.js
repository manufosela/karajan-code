/**
 * Phantom coverage (KJC-TSK-0800, epic KJC-PCS-0081) — a phantom test is
 * worse than no test: it adds to the count, feels like a net, and covers
 * nothing. TWO detectors, because one is not enough: the call graph catches
 * a unit test that only exercises unreachable members, and LITERAL crossing
 * catches the case the graph cannot see — GREBLA's hierarchy.spec called no
 * dead method, it looked for an aria-label that only existed inside one.
 * Both inherit the reachability perimeter: a NOT OBSERVABLE analysis makes
 * the detector not observable — no test is accused on an unreliable basis.
 */
import { parse } from "@babel/parser";

const parseLoose = (source, file) =>
  parse(source, {
    sourceType: "unambiguous", allowReturnOutsideFunction: true,
    plugins: [...(/\.(ts|tsx|mts|cts)$/.test(file) ? ["typescript"] : []), ...(/\.(tsx|jsx)$/.test(file) || !/\.(ts|mts|cts)$/.test(file) ? ["jsx"] : []), "decorators"],
  });

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(c, visit));
    else if (child && typeof child.type === "string") walk(child, visit);
  }
}

const notObservable = (sourceAnalysis) => {
  if (!sourceAnalysis?.observable) return sourceAnalysis?.reason || "the reachability analysis is not observable";
  const classes = (sourceAnalysis.classes || []).filter((c) => c.observable);
  if (classes.length === 0) return "no class in the source is observable — the analysis cannot vouch for anything";
  return null;
};
const observableClasses = (a) => (a.classes || []).filter((c) => c.observable);
const bareName = (slot) => slot.replace(/^static /, "");

/**
 * Unit detector: of the test's member CALLS that belong to an analyzed class,
 * do all of them land on unreachable members? One live call absolves.
 * @returns {{observable: boolean, reason?: string, phantoms: Array<{member: string, className: string}>}}
 */
export function detectPhantomUnit({ sourceAnalysis, testSource, file = "<test>" }) {
  const why = notObservable(sourceAnalysis);
  if (why) return { observable: false, reason: `not observable: ${why}`, phantoms: [] };
  let tree;
  try { tree = parseLoose(testSource, file); } catch (err) {
    return { observable: false, reason: `the test could not be parsed (${err.message})`, phantoms: [] };
  }
  // Calls grouped by RECEIVER (weak binding, reviewer's catch): a receiver is
  // tied to a class only when EVERY member it calls belongs to that class —
  // mixing two objects under one name must not get a test accused.
  const byReceiver = new Map();
  walk(tree, (n) => {
    if (n.type !== "CallExpression" || n.callee?.type !== "MemberExpression" || n.callee.computed || n.callee.property?.type !== "Identifier") return;
    const recv = n.callee.object?.type === "Identifier" ? n.callee.object.name : n.callee.object?.type === "ThisExpression" ? "this" : "(expr)";
    (byReceiver.get(recv) ?? byReceiver.set(recv, new Set()).get(recv)).add(n.callee.property.name);
  });
  const phantoms = [];
  for (const c of observableClasses(sourceAnalysis)) {
    const members = new Set(c.memberNames.map(bareName));
    const dead = new Set(c.unreachable.map((u) => bareName(u.name)));
    for (const [, names] of byReceiver) {
      const touched = [...names].filter((n) => members.has(n));
      // bound to this class, and everything it touches is dead → phantom;
      // one live call — or a call outside the class — absolves the receiver.
      if (touched.length > 0 && touched.length === names.size && touched.every((n) => dead.has(n))) {
        for (const n of touched) phantoms.push({ member: n, className: c.name, file });
      }
    }
  }
  return { observable: true, phantoms };
}

const literalsOf = (tree, minLength) => {
  const out = [];
  walk(tree, (n) => {
    if (n.type === "StringLiteral" && n.value.trim().length >= minLength) out.push({ value: n.value, line: n.loc.start.line, template: false });
    if (n.type === "TemplateElement" && n.value.cooked && n.value.cooked.trim().length >= minLength) out.push({ value: n.value.cooked, line: n.loc.start.line, template: true });
  });
  return out;
};

// KJC-BUG-0158 (GREBLA's field validation): an interpolated label —
// aria-label="Head al que reporta ${name}" — never matches the RESOLVED
// string a test looks for, and in Lit that is the usual case, not the
// exception. The static chunk carries markup before the label, so the right
// crossing is: the longest SUFFIX of a template chunk that is a PREFIX of the
// test's literal. Threshold contains false positives; a LIVE chunk producing
// the same start absolves — covering interpolation must never accuse live UI.
const PREFIX_MIN = 8;
const overlap = (chunk, wanted) => {
  for (let k = Math.min(chunk.length, wanted.length); k >= PREFIX_MIN; k--) {
    if (chunk.endsWith(wanted.slice(0, k))) return k;
  }
  return 0;
};

/**
 * E2E detector: literals the test looks for that ONLY exist inside
 * unreachable spans of the source. A literal also present in reachable code
 * is never reported — that test does cover something.
 * @returns {{observable: boolean, reason?: string, phantoms: Array<{literal: string, line: number}>}}
 */
export function detectPhantomE2E({ sourceText, sourceAnalysis, testSource, file = "<spec>", minLength = 4 }) {
  const why = notObservable(sourceAnalysis);
  if (why) return { observable: false, reason: `not observable: ${why}`, phantoms: [] };
  let sourceTree, testTree;
  try {
    sourceTree = parseLoose(sourceText, sourceAnalysis.file || "<source>");
    testTree = parseLoose(testSource, file);
  } catch (err) {
    return { observable: false, reason: `could not be parsed (${err.message})`, phantoms: [] };
  }
  const deadSpans = observableClasses(sourceAnalysis).flatMap((c) => c.unreachable.map((u) => [u.line, u.endLine]));
  const inDead = (line) => deadSpans.some(([a, b]) => line >= a && line <= b);
  const sourceLits = literalsOf(sourceTree, minLength);
  const onlyInDead = new Map(); // literal → line where it lives
  for (const lit of sourceLits) {
    if (inDead(lit.line)) { if (!onlyInDead.has(lit.value)) onlyInDead.set(lit.value, lit.line); }
    else onlyInDead.set(lit.value, -1); // seen reachable — poisoned, never reportable
  }
  // KJC-BUG-0159 (GREBLA's field catch): file+line point at the TEST — that is
  // where the fix happens; the dead code's spot travels as sourceLine. A
  // finding at spec.js:2183 on a 32-line spec sends the reader nowhere.
  const wanted = new Map(); // literal → its line IN THE TEST (first sighting)
  for (const l of literalsOf(testTree, minLength)) if (!wanted.has(l.value)) wanted.set(l.value, l.line);
  const phantoms = [...wanted.entries()]
    .filter(([v]) => onlyInDead.get(v) !== undefined && onlyInDead.get(v) !== -1)
    .map(([v, testLine]) => ({ literal: v, file, line: testLine, sourceLine: onlyInDead.get(v) }));
  // KJC-BUG-0158: interpolated labels match by static-chunk prefix. Dead wins
  // only when NO live chunk produces at least the same start.
  const chunks = sourceLits.filter((l) => l.template);
  for (const [v, testLine] of wanted) {
    if (phantoms.some((p) => p.literal === v)) continue;
    // the exact literal living in REACHABLE code absolves here too (codex's
    // catch): that test does point at something alive.
    if (onlyInDead.get(v) === -1) continue;
    let kDead = 0, kLive = 0, deadLine = 0;
    for (const c of chunks) {
      // a chunk CONTAINING the whole literal is the strongest match either way
      const k = c.value.includes(v) ? v.length : overlap(c.value, v);
      if (inDead(c.line)) { if (k > kDead) { kDead = k; deadLine = c.line; } }
      else if (k > kLive) kLive = k;
    }
    if (kDead >= PREFIX_MIN && kDead > kLive) phantoms.push({ literal: v, file, line: testLine, sourceLine: deadLine });
  }
  return { observable: true, phantoms };
}

/**
 * The temporal signature — zero static analysis, and it would have been
 * enough for GREBLA: a bug gets fixed or reverted; a phantom fails the SAME
 * way indefinitely because it proves something that no longer exists.
 * kj holds no per-test history, so the source is INJECTED and said:
 * failures = [{test, reason, at}] from whoever owns the CI history.
 */
export function assessTemporalSignature({ failures, thresholdDays = 7 } = {}) {
  if (!Array.isArray(failures)) {
    return { observable: false, reason: "no per-test failure history handed in — kj holds none; inject it from the CI that owns it", suspects: [] };
  }
  const byTest = new Map();
  for (const f of failures) (byTest.get(f.test) ?? byTest.set(f.test, []).get(f.test)).push(f);
  const suspects = [];
  for (const [test, rows] of byTest) {
    const reasons = new Set(rows.map((r) => String(r.reason || "").trim().toLowerCase()));
    if (reasons.size !== 1) continue; // changing reasons look like a bug being worked
    const times = rows.map((r) => Date.parse(r.at)).filter(Number.isFinite);
    if (times.length < 2) continue;
    const days = Math.floor((Math.max(...times) - Math.min(...times)) / 86_400_000);
    if (days >= thresholdDays) suspects.push({ test, reason: rows[0].reason, days, firstAt: new Date(Math.min(...times)).toISOString(), lastAt: new Date(Math.max(...times)).toISOString() });
  }
  return { observable: true, suspects };
}
