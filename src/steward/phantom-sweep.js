/**
 * Phantom sweep (KJC-TSK-1343) — finds the test↔source pairs the phantom
 * detectors (KJC-TSK-0800) need and runs them. Only Lit components sit inside
 * the reachability perimeter, so only they can make a test a phantom; anywhere
 * else the answer is NOT OBSERVABLE with its reason, never a clean bill.
 */
import fs from "node:fs";
import path from "node:path";
import { analyzeMemberReachability } from "../audit/member-reachability.js";
import { detectPhantomUnit, detectPhantomE2E } from "./phantom-coverage.js";
import { listProjectFiles } from "../rag/indexable.js";

const CODE = /\.(m?js|jsx|ts|tsx|mts)$/;
const TEST = /\.(test|spec)\.(m?js|jsx|ts|tsx|mts)$/;
const RELATIVE_IMPORT = /(?:from\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SUFFIXES = ["", ".js", ".mjs", ".ts", ".tsx", ".jsx", "/index.js", "/index.ts"];

/** The candidate sources a test imports through relative specifiers. */
function importedCandidates(test, text, candidates) {
  const out = new Set();
  for (const [, spec] of text.matchAll(RELATIVE_IMPORT)) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(test), spec));
    const hit = SUFFIXES.map((s) => base + s).find((p) => candidates.has(p));
    if (hit) out.add(hit);
  }
  return out;
}

const defaultRead = (projectDir) => (rel) => fs.readFileSync(path.join(projectDir, rel), "utf8");

/**
 * @param {{projectDir: string, files?: string[]|null, read?: (rel: string) => string}} opts
 * @returns {{observable: boolean, reason?: string, phantoms?: Array<object>}}
 */
export function sweepPhantoms({ projectDir, files = listProjectFiles(projectDir), read = defaultRead(projectDir) }) {
  if (!Array.isArray(files)) return { observable: false, reason: "not a git repository: the project's tests and sources cannot be listed" };
  const texts = new Map();
  for (const f of files.filter((x) => CODE.test(x))) {
    try { texts.set(f, read(f)); } catch { /* listed but gone from the tree: nothing to read */ }
  }
  const tests = [...texts.keys()].filter((f) => TEST.test(f));
  const sources = [...texts.keys()].filter((f) => !TEST.test(f));
  const analyzed = sources
    .filter((f) => texts.get(f).includes("LitElement"))
    .map((file) => ({ file, analysis: analyzeMemberReachability(texts.get(file), { file }) }))
    .filter(({ analysis }) => analysis.observable && analysis.classes.some((c) => c.observable));
  if (analyzed.length === 0) {
    return { observable: false, reason: "no observable Lit component (LitElement): the reachability analysis only vouches for Lit" };
  }
  const candidates = new Map(analyzed
    .filter(({ analysis }) => analysis.classes.some((c) => c.observable && c.unreachable.length > 0))
    .map((c) => [c.file, c.analysis]));
  const phantoms = [];
  for (const test of tests) {
    const testSource = texts.get(test);
    for (const file of importedCandidates(test, testSource, candidates)) {
      phantoms.push(...detectPhantomUnit({ sourceAnalysis: candidates.get(file), testSource, file: test }).phantoms);
    }
    for (const [file, analysis] of candidates) {
      const found = detectPhantomE2E({ sourceText: texts.get(file), sourceAnalysis: analysis, testSource, file: test }).phantoms;
      // a literal another source also carries may be alive there: never accused
      phantoms.push(...found.filter((p) => !sources.some((s) => s !== file && texts.get(s).includes(p.literal))));
    }
  }
  return { observable: true, phantoms };
}
