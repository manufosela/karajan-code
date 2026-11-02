/**
 * KJC-TSK-1380 (#3207): facts about a diff computed without a model, each with its
 * file:line where it has one. The reviewer starts from them and keeps the judgement;
 * they inform, they never block on their own.
 */
import { scanText, loadPrivacyList } from "../privacy/scan.js";

const MAX_SIZE_FACTS = 10;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.([cm]?[jt]sx?|py|go|rb|java|rs|php|cs|kt|swift)$/;
const DYNAMIC_IMPORT = /await\s+import\(\s*["'`]([^"'`]+)["'`]\s*\)/;
const STATIC_IMPORT = /^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm;
const DEP_LINE = /^\s*"([^"]+)":\s*"([^"]*)"\s*,?\s*$/;
const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const NOT_DEPS = new Set(["name", "version", "description", "main", "module", "types", "license", "type", "node", "npm"]);

/** Added lines (with their line in the new file) and removed counts, per file. */
function parseDiff(diff) {
  const files = new Map();
  let current = null;
  let line = 0;
  let name;
  for (const raw of String(diff).split("\n")) {
    if (raw.startsWith("diff --git ")) {
      name = / b\/(.+)$/.exec(raw)?.[1] ?? null;
      current = name ? { added: [], removed: 0 } : null;
      if (current) files.set(name, current);
      line = 1;
    } else if (raw.startsWith("+++ ")) {
      continue; // file header, not an added line (the file was named by "diff --git")
    } else if (raw.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 1);
    } else if (current && raw.startsWith("+")) {
      current.added.push({ line, text: raw.slice(1) });
      line += 1;
    } else if (current && raw.startsWith("-") && !raw.startsWith("---")) {
      current.removed += 1;
    } else if (current && raw.startsWith(" ")) {
      line += 1;
    }
  }
  return files;
}

function declaredDeps(readFile, name) {
  try {
    const pkg = JSON.parse(readFile(name));
    return new Set(DEP_SECTIONS.flatMap((s) => Object.keys(pkg[s] || {})));
  } catch { return null; } // unreadable: fall back to the shape of the line
}

function dependencyFacts(name, added, readFile) {
  if (!/(^|\/)package\.json$/.test(name)) return [];
  const deps = readFile ? declaredDeps(readFile, name) : null;
  return added.flatMap(({ line, text }) => {
    const m = DEP_LINE.exec(text);
    if (!m) return [];
    const isDep = deps ? deps.has(m[1]) : !NOT_DEPS.has(m[1]) && /^[\^~<>=*\d]|^(npm|workspace|file|git)/.test(m[2]);
    return isDep ? [{ kind: "new-dependency", file: name, line, text: `adds dependency ${m[1]}@${m[2]}` }] : [];
  });
}

function dynamicImportFacts(name, added, readFile) {
  if (!readFile) return [];
  let content;
  try { content = readFile(name); } catch { return []; }
  const staticSpecs = new Set([...content.matchAll(STATIC_IMPORT)].map((m) => m[1]));
  return added.flatMap(({ line, text }) => {
    const spec = DYNAMIC_IMPORT.exec(text)?.[1];
    return spec && staticSpecs.has(spec) ? [{ kind: "redundant-dynamic-import", file: name, line, text: `await import("${spec}") of a module this file already imports statically` }] : [];
  });
}

function secretFacts(name, added, list) {
  return added.flatMap(({ line, text }) => scanText(text, { list, source: name })
    .filter((f) => f.severity === "block" || f.type === "secret-assignment")
    .map((f) => ({ kind: "secret-shape", file: name, line, text: `${f.type}: ${f.masked}` })));
}

/**
 * @param {string} diff unified diff
 * @param {{ readFile?: (path: string) => string, list?: object }} [opts] readFile reads a file as it is after the diff
 */
export function diffFacts(diff, { readFile = null, list } = {}) {
  const files = parseDiff(diff);
  const names = [...files.keys()];
  const privacy = list ?? loadPrivacyList(); // read once, not per added line
  const facts = [...files]
    .toSorted(([, a], [, b]) => (b.added.length + b.removed) - (a.added.length + a.removed))
    .slice(0, MAX_SIZE_FACTS)
    .map(([name, f]) => ({ kind: "size", file: name, text: `+${f.added.length} / -${f.removed}` }));
  const code = names.filter((n) => CODE_FILE.test(n) && !TEST_FILE.test(n));
  if (code.length > 0 && !names.some((n) => TEST_FILE.test(n))) {
    facts.push({ kind: "no-tests", text: `code changes in ${code.length} file(s) and no test file is touched` });
  }
  for (const [name, f] of files) {
    facts.push(...dependencyFacts(name, f.added, readFile), ...dynamicImportFacts(name, f.added, readFile),
      ...secretFacts(name, f.added, privacy));
  }
  return facts;
}

/** The facts as a prompt block; empty when there are none. */
export function formatDiffFacts(facts) {
  if (!facts?.length) return "";
  const where = (f) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ""} ` : "");
  return ["## Verified facts (computed without a model)",
    "Checked mechanically on this diff. Start from them; judging what they mean is yours.",
    ...facts.map((f) => `- ${where(f)}${f.text}`)].join("\n");
}
