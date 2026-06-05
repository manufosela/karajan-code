// AI-slop tells detector — KJC-TSK-0503. Deterministic, offline,
// regex-based scanner over JS/TS source. Five categories:
// tautologic-comments, banner-separators, boilerplate-docstrings,
// magic-fallbacks, redundant-jsdoc. Score 100 = clean.

import fs from "node:fs";
import path from "node:path";

const FILE_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", "coverage",
  ".git", ".karajan", "public", ".next", ".nuxt", ".vercel", ".cache",
]);
const VERB = "(?:returns?|gets?|sets?|fetches?|loads?|saves?|creates?|builds?|makes?|computes?|handles?|checks?|validates?)";
const LINE_PATTERNS = {
  "banner-separators": /\/[/*]\s*[=*\-_#~]{5,}/,
  "magic-fallbacks": /(\?\?|\|\|)\s*(?:""|''|null|undefined)\s*(?:\)|;|,|$)/,
  "redundant-jsdoc": new RegExp(`@param\\s+\\{[^}]+\\}\\s+(\\w+)\\s+(?:-\\s*)?(?:the\\s+)?\\1\\s+(?:parameter|argument|value)`, "i"),
};
const TAUT_RE = new RegExp(`^\\s*//\\s*${VERB}\\s+(?:the\\s+|a\\s+|an\\s+)?(\\w+)\\s*\\.?\\s*$`, "i");
const DOC_RE = new RegExp(`^\\s*/\\*\\*\\s*${VERB}\\s+(?:the\\s+|a\\s+|an\\s+)?(\\w+)\\s*\\.?\\s*\\*/\\s*$`, "i");
const DECL_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/;

export const CATEGORIES = Object.freeze([
  "tautologic-comments", "banner-separators", "boilerplate-docstrings",
  "magic-fallbacks", "redundant-jsdoc",
]);

function nextDecl(lines, from) {
  for (let j = from; j < Math.min(from + 3, lines.length); j++) {
    const m = lines[j]?.match(DECL_RE);
    if (m) return m[1];
  }
  return null;
}
const stem = (a, b) => { const al = a.toLowerCase(), bl = b.toLowerCase(); return al === bl || al.includes(bl) || bl.includes(al); };

export function scanText(relPath, text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    for (const [category, re] of Object.entries(LINE_PATTERNS)) {
      if (re.test(line)) out.push({ path: relPath, line: lineNo, category, snippet: line.trim().slice(0, 100) });
    }
    const t = line.match(TAUT_RE);
    if (t) {
      const decl = nextDecl(lines, i + 1);
      if (decl && stem(decl, t[1])) out.push({ path: relPath, line: lineNo, category: "tautologic-comments", snippet: line.trim().slice(0, 100) });
    }
    const d = line.match(DOC_RE);
    if (d) {
      const decl = nextDecl(lines, i + 1);
      if (decl && stem(decl, d[1])) out.push({ path: relPath, line: lineNo, category: "boilerplate-docstrings", snippet: line.trim().slice(0, 100) });
    }
  }
  return out;
}

function listSourceFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (FILE_EXTS.has(path.extname(e.name))) out.push(full);
    }
  }
  return out;
}

export async function collectAiSlop(rootDir, opts = {}) {
  const maxLOC = Number.isFinite(opts.maxLOC) ? opts.maxLOC : 200_000;
  const maxWorst = Number.isFinite(opts.maxWorst) ? opts.maxWorst : 10;
  try {
    const findings = [];
    let totalLOC = 0, filesScanned = 0;
    for (const file of listSourceFiles(rootDir)) {
      if (totalLOC >= maxLOC) break;
      let content;
      try { content = fs.readFileSync(file, "utf-8"); } catch { continue; }
      findings.push(...scanText(path.relative(rootDir, file) || file, content));
      totalLOC += content.split(/\r?\n/).length;
      filesScanned++;
    }
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    for (const f of findings) byCategory[f.category]++;
    const density = totalLOC > 0 ? (findings.length / totalLOC) * 100 : 0;
    const score = Math.max(0, Math.min(100, Math.round(100 - density * 100)));
    const worst = findings.slice().sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path))).slice(0, maxWorst);
    return { available: true, filesScanned, totalLOC, total: findings.length, score, byCategory, worst };
  } catch (err) {
    return { available: false, reason: err?.message || String(err) };
  }
}
