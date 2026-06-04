#!/usr/bin/env node
/**
 * scripts/audit-test-diet.mjs — semantic loss-of-meaning auditor (KJC-TSK-0345).
 * Categories: empty-no-expect, skipped-pending, imports-orphan, deprecated-export,
 * subsumed-candidate. Each finding carries confidence (high|low). Complements
 * tests/_diet/audit.mjs (which classifies by LOC bucket only).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "..");
const SKIP_DIRS = new Set(["_diet", "fixtures", "node_modules"]);

export function walkTests(rootDir, testsSubdir = "tests") {
  const out = [];
  const base = join(rootDir, testsSubdir);
  if (!existsSync(base)) return out;
  const stack = [base];
  while (stack.length) {
    for (const e of readdirSync(stack.pop(), { withFileTypes: true })) {
      const p = join(e.parentPath ?? base, e.name);
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) stack.push(p);
      else if (e.isFile() && /\.test\.(m?js|ts)$/.test(e.name)) out.push(p);
    }
  }
  return out;
}

export function parseImports(source) {
  const imports = [];
  const re = /^[ \t]*import\s+(?:([\w*\s{},]+?)\s+from\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    const named = [];
    const braced = (m[1] || "").match(/\{([^}]+)\}/);
    if (braced) for (const part of braced[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) named.push(name);
    }
    imports.push({ specifier: m[2], named });
  }
  return imports;
}

export function resolveSrcImport(testFile, specifier, rootDir) {
  if (!specifier.startsWith(".") && !specifier.startsWith("#")) return null;
  const base = specifier.startsWith("#") ? resolve(rootDir, specifier.replace(/^#/, "src/")) : resolve(dirname(testFile), specifier);
  for (const c of [base, `${base}.js`, `${base}.mjs`, join(base, "index.js")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export function extractItNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/\b(?:it|test)(?:\.(?:only|skip|todo))?\s*\(\s*['"`]([^'"`]+)['"`]/g)) names.add(m[1]);
  return names;
}

export function extractExports(source) {
  const names = new Set();
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s*\{([^}]+)\}/g)) for (const part of m[1].split(",")) {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (name) names.add(name);
  }
  if (/export\s+default\b/.test(source)) names.add("default");
  return names;
}

export function auditFile(testFile, rootDir) {
  const source = readFileSync(testFile, "utf-8");
  const rel = relative(rootDir, testFile);
  const findings = [];
  const hasIt = /\b(?:it|test)\s*\(/.test(source);
  if (hasIt && !/\bexpect\s*\(/.test(source)) findings.push({ category: "empty-no-expect", confidence: "high", detail: "it()/test() blocks with no expect()" });
  if (/\b(?:it|test|describe)\.skip\s*\(|\bxit\s*\(|\bxtest\s*\(|\b(?:it|test)\.todo\s*\(/.test(source)) {
    findings.push({ category: "skipped-pending", confidence: "high", detail: "uses .skip / xit / xtest / .todo" });
  }
  const srcImports = [];
  for (const imp of parseImports(source)) {
    if (!imp.specifier.startsWith(".") && !imp.specifier.startsWith("#")) continue;
    const resolved = resolveSrcImport(testFile, imp.specifier, rootDir);
    if (!resolved) { findings.push({ category: "imports-orphan", confidence: "high", detail: `cannot resolve '${imp.specifier}'` }); continue; }
    if (imp.named.length) {
      const missing = imp.named.filter((n) => !extractExports(readFileSync(resolved, "utf-8")).has(n));
      if (missing.length) findings.push({ category: "deprecated-export", confidence: "low", detail: `${imp.specifier} no longer exports: ${missing.join(", ")}` });
    }
    srcImports.push({ resolved: relative(rootDir, resolved), named: imp.named });
  }
  return { path: rel, srcImports, findings, itNames: extractItNames(source) };
}

export function findSubsumed(perFile) {
  const bySrc = new Map();
  for (const f of perFile) for (const imp of f.srcImports) {
    if (!bySrc.has(imp.resolved)) bySrc.set(imp.resolved, []);
    bySrc.get(imp.resolved).push({ path: f.path, named: new Set(imp.named), itNames: f.itNames });
  }
  const out = [];
  for (const [src, consumers] of bySrc) {
    if (consumers.length < 2) continue;
    const sorted = [...consumers].sort((a, b) => a.named.size - b.named.size);
    const narrow = sorted[0]; const broad = sorted[sorted.length - 1];
    if (narrow.path === broad.path || narrow.named.size === 0 || broad.named.size === 0) continue;
    if (!(narrow.named.size < broad.named.size && [...narrow.named].every((n) => broad.named.has(n)))) continue;
    // Require ≥50% of narrow's it() names to also appear in broad's. Imports
    // alone are a false-positive trap: two tests can share helpers and assert
    // on disjoint behavior (e.g. tests/budget.test.js vs tests/utils/budget.test.js).
    if (narrow.itNames.size === 0) continue;
    const overlap = [...narrow.itNames].filter((n) => broad.itNames.has(n)).length;
    if (overlap / narrow.itNames.size < 0.5) continue;
    out.push({ category: "subsumed-candidate", confidence: "low", path: narrow.path, detail: `${overlap}/${narrow.itNames.size} it() names also in ${broad.path}; subset of imports from ${src}` });
  }
  return out;
}

export function auditTestDiet(rootDir = DEFAULT_ROOT) {
  const files = walkTests(rootDir);
  const perFile = files.map((f) => auditFile(f, rootDir));
  const findings = [];
  for (const f of perFile) for (const x of f.findings) findings.push({ path: f.path, ...x });
  for (const s of findSubsumed(perFile)) findings.push(s);
  return { generatedAt: new Date().toISOString(), rootDir, totals: { filesAudited: files.length, findings: findings.length }, findings };
}

export function renderMarkdown(report) {
  const byCat = new Map();
  for (const f of report.findings) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category).push(f);
  }
  const lines = [`# Semantic test-diet audit`, ``, `Generated: ${report.generatedAt}`, `Files audited: ${report.totals.filesAudited}`, `Findings: ${report.totals.findings}`, ``];
  for (const [cat, items] of byCat) {
    lines.push(`## ${cat} (${items.length})`, ``);
    for (const it of items) lines.push(`- \`${it.path}\` — ${it.detail} (confidence: ${it.confidence})`);
    lines.push(``);
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = auditTestDiet(DEFAULT_ROOT);
  const outDir = join(DEFAULT_ROOT, "audit");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "test-diet-semantic.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "test-diet-semantic.md"), renderMarkdown(report));
  console.log(`audit: ${report.totals.filesAudited} files, ${report.totals.findings} findings -> audit/test-diet-semantic.{json,md}`);
}
