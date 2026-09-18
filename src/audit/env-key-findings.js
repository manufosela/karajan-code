/**
 * Env/config key resolution collector for `kj audit` (KJC-TSK-0845).
 *
 * The same key resolved by two modules with two rules is a migration left
 * half-way: KJ_HOME → KARAJAN_HOME reached the runtime and not the installer
 * (KJC-BUG-0179), and the MCP resolved the home unlike the CLI (KJC-BUG-0176).
 * Zero tokens, lexical, best-effort — same shape as injection-findings:
 *   - divergent: one key, read with an explicit fallback chain (`||` / `??`)
 *     that differs between files. Plain reads consume a value and resolve
 *     nothing, so they never count: no false positive on a consumer.
 *   - incomplete-migration: a file reads a deprecated key and never names its
 *     successor.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const DEPRECATED_KEYS = { KJ_HOME: "KARAJAN_HOME" };
const ROOTS = ["src", "scripts", "bin", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "tests", "test", "__tests__", "docs", "public"]);
const ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g;
const CONFIG_START = /\bconfig(?=\??\.[a-z])/g;
const SEGMENT = /^\??\.([a-z][a-z0-9_]*)/;
const STOP = new Set([" ", "\t", ";", ",", "|", "?", ":"]);

/** `  || rest` → { op, consumed } with the surrounding blanks, or null when no operator follows. */
function operatorAt(s) {
  const t = s.trimStart();
  const op = ["||", "??"].find((o) => t.startsWith(o)) ?? null;
  if (!op) return null;
  const afterOp = t.slice(op.length);
  return { op, consumed: s.length - afterOp.trimStart().length };
}

/** `config.a?.b` → { key: "a.b", length } read from just after `config`, or null. */
function configPath(rest) {
  const segments = [];
  let s = rest;
  for (let m = SEGMENT.exec(s); m; m = SEGMENT.exec(s)) {
    segments.push(m[1]);
    s = s.slice(m[0].length);
  }
  return segments.length > 0 ? { key: segments.join("."), length: rest.length - s.length } : null;
}

/** One fallback operand: a quoted literal, or an expression up to the next operator, with balanced brackets. */
function readOperand(s) {
  const quote = s[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const end = s.indexOf(quote, 1);
    return end === -1 ? null : s.slice(0, end + 1);
  }
  const n = operandLength(s);
  return n > 0 ? s.slice(0, n) : null;
}

/** Length of the expression at the start of `s`: up to the next operator or unbalanced close. */
function operandLength(s) {
  // Optional chaining (`a?.b`) is not an operator boundary: flatten it, same length.
  const flat = s.replaceAll("?.", "..");
  let depth = 0;
  for (let i = 0; i < flat.length; i += 1) {
    const c = flat[i];
    if (c === "(" || c === "[") {
      depth += 1;
    } else if (c === ")" || c === "]") {
      if (depth === 0) { return i; }
      depth -= 1;
    } else if (depth === 0 && STOP.has(c)) {
      return i;
    }
  }
  return flat.length;
}

async function listJsFiles(dir, depth = 0) {
  if (depth > 8) return [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...(await listJsFiles(p, depth + 1))); }
    else if (/\.(m?js|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The fallback chain written after a subject on the same line, normalized. */
export function fallbackChain(rest) {
  const chain = [];
  let s = rest;
  for (;;) {
    const op = operatorAt(s);
    if (!op) break;
    const operand = readOperand(s.slice(op.consumed));
    if (!operand) break;
    // The operator is part of the rule: `|| "x"` and `?? "x"` resolve differently.
    chain.push(`${op.op} ${operand.replaceAll(/\s+/g, "")}`);
    s = s.slice(op.consumed + operand.length);
  }
  return chain;
}

/** Every subject read in one file: { key, kind, line, chain }. */
export function readsIn(text) {
  const reads = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const m of line.matchAll(ENV_READ)) {
      reads.push({ key: m[1] || m[2], kind: "env", line: i + 1, chain: fallbackChain(line.slice(m.index + m[0].length)) });
    }
    for (const m of line.matchAll(CONFIG_START)) {
      const after = m.index + m[0].length;
      const p = configPath(line.slice(after));
      if (p) reads.push({ key: p.key, kind: "config", line: i + 1, chain: fallbackChain(line.slice(after + p.length)) });
    }
  });
  return reads;
}

export async function collectEnvKeyFindings(projectDir, { roots = ROOTS } = {}) {
  if (!projectDir) return { available: false, reason: "projectDir not provided" };
  const files = (await Promise.all(roots.map((r) => listJsFiles(path.join(projectDir, r))))).flat();
  const sites = new Map(); // key → [{ file, line, chain }] (only reads WITH a chain)
  const incomplete = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const rel = path.relative(projectDir, file);
    const reads = readsIn(text);
    for (const r of reads) {
      if (r.chain.length === 0) continue;
      // One subject per namespace: process.env.PORT and config.port never compare.
      const id = `${r.kind}:${r.key}`;
      if (!sites.has(id)) sites.set(id, []);
      sites.get(id).push({ file: rel, line: r.line, chain: r.chain });
    }
    for (const [old, successor] of Object.entries(DEPRECATED_KEYS)) {
      // The successor must be READ in the file (a comment naming it is not a migration).
      const hit = reads.find((r) => r.key === old);
      if (hit && !reads.some((r) => r.key === successor)) incomplete.push({ key: old, successor, file: rel, line: hit.line });
    }
  }
  const divergent = [];
  for (const [id, list] of sites) {
    const [kind, key] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    const rules = new Map();
    for (const s of list) {
      const rule = `${key} ${s.chain.join(" ")}`;
      if (!rules.has(rule)) rules.set(rule, []);
      rules.get(rule).push(s);
    }
    if (rules.size > 1 && new Set(list.map((s) => s.file)).size > 1) {
      divergent.push({ key, kind, rules: [...rules].map(([rule, at]) => ({ rule, sites: at.map((s) => `${s.file}:${s.line}`) })) });
    }
  }
  divergent.sort((a, b) => a.key.localeCompare(b.key));
  return { available: true, scanned: files.length, divergent, incomplete };
}

export function groupEnvKeyFindingsBySeverity({ divergent = [], incomplete = [] } = {}) {
  return { HIGH: incomplete, MEDIUM: divergent };
}
