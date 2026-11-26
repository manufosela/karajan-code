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
  let baseLine = 0;
  let name;
  for (const raw of String(diff).split("\n")) {
    if (raw.startsWith("diff --git ")) {
      name = / b\/(.+)$/.exec(raw)?.[1] ?? null;
      current = name ? { added: [], removed: 0, removedLines: [], isNew: false } : null;
      if (current) files.set(name, current);
      line = 1;
    } else if (current && (raw.startsWith("new file mode") || raw === "--- /dev/null")) {
      current.isNew = true; // HU-4872: a new file has no base to weaken
    } else if (raw.startsWith("+++ ")) {
      continue; // file header, not an added line (the file was named by "diff --git")
    } else if (raw.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 1);
      baseLine = Number(/-(\d+)/.exec(raw)?.[1] ?? 1);
    } else if (current && raw.startsWith("+")) {
      current.added.push({ line, text: raw.slice(1) });
      line += 1;
    } else if (current && raw.startsWith("-") && !raw.startsWith("---")) {
      current.removed += 1;
      current.removedLines.push({ line: baseLine, text: raw.slice(1) });
      baseLine += 1;
    } else if (current && raw.startsWith(" ")) {
      line += 1;
      baseLine += 1;
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

const ASSERTION = /^\s*(?:await\s+)?(expect|assert(?:\.\w+|[A-Z]\w*)?)\s*\(/;

/** HU-4872: what an assertion is about: expect(<subject>) or the assert call with its first argument. */
function assertionSubject(text) {
  const m = ASSERTION.exec(text);
  if (!m) return null;
  let depth = 1;
  let end = m[0].length;
  for (; end < text.length && depth > 0; end += 1) {
    if ("([{".includes(text[end])) depth += 1;
    else if (")]}".includes(text[end])) depth -= 1;
    else if (text[end] === "," && depth === 1 && m[1] !== "expect") break;
  }
  return `${m[1]}(${text.slice(m[0].length, end)}`;
}

/**
 * HU-4872: an assertion an existing test loses. Added back as is to any test file of the diff (kept), it moved: no fact.
 * Another one added on its subject in the same file rewrites it: assertion-rewritten, for the reviewer. Neither: test-weakened.
 */
function testWeakenedFacts(name, f, kept) {
  if (!TEST_FILE.test(name) || f.isNew) return [];
  const addedBySubject = Map.groupBy(f.added, (a) => assertionSubject(a.text));
  return f.removedLines.flatMap(({ line, text }) => {
    const subject = assertionSubject(text);
    const removed = text.trim();
    if (!subject || kept.has(removed)) return [];
    const rewrite = addedBySubject.get(subject)?.[0].text.trim();
    if (rewrite) return [{ kind: "assertion-rewritten", file: name, line, text: `rewrites the assertion ${removed} as ${rewrite}` }];
    return [{ kind: "test-weakened", file: name, line, text: `removes the assertion ${removed}` }];
  });
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
  const kept = new Set([...files].filter(([n]) => TEST_FILE.test(n)).flatMap(([, f]) => f.added.map((a) => a.text.trim())));
  for (const [name, f] of files) {
    facts.push(...dependencyFacts(name, f.added, readFile), ...dynamicImportFacts(name, f.added, readFile),
      ...secretFacts(name, f.added, privacy), ...testWeakenedFacts(name, f, kept));
  }
  return facts;
}

/** The facts as a prompt block, with an optional note; empty when there is neither. */
export function formatDiffFacts(facts, note = "") {
  if (!facts?.length) return note;
  const where = (f) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ""} ` : "");
  return ["## Verified facts (computed without a model)",
    "Checked mechanically on this diff. Start from them; judging what they mean is yours.",
    ...(note ? [note] : []),
    ...facts.map((f) => `- ${where(f)}${f.text}`)].join("\n");
}
