/**
 * Prompt-injection findings collector for `kj audit` (KJC-TSK-0498).
 * Scans `.karajan/specs/**`, `.karajan/domain.md` and
 * `.karajan/onboarding/**` reusing `src/utils/injection-guard.js`.
 * Best-effort: missing folders return `scanned: 0`.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { scanForInjection } from "../utils/injection-guard.js";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_DEPTH = 6;
const SEVERITY_BY_TYPE = { directive: "HIGH", unicode: "MEDIUM", comment_block: "LOW" };

const SCAN_TARGETS = [
  { rel: ".karajan/specs", kind: "dir" },
  { rel: ".karajan/onboarding", kind: "dir" },
  { rel: ".karajan/domain.md", kind: "file" },
  // KJC-TSK-0695: the agent-context surface — whatever lands in the host
  // agent's context every session is the real injection vector.
  { rel: "CLAUDE.md", kind: "file" },
  { rel: "AGENTS.md", kind: "file" },
  { rel: "GEMINI.md", kind: "file" },
  { rel: ".cursorrules", kind: "file" },
  { rel: path.join(".github", "copilot-instructions.md"), kind: "file" },
  { rel: "templates", kind: "dir" },
  { rel: ".rulesync", kind: "dir" },
];

export async function collectInjectionFindings(rootDir, logger = null) {
  if (!rootDir) return { available: false, reason: "rootDir not provided" };
  const findings = [];
  let scanned = 0;
  try {
    for (const target of SCAN_TARGETS) {
      const abs = path.join(rootDir, target.rel);
      const files = target.kind === "dir"
        ? await listFiles(abs, 0)
        : (await fileExists(abs)) ? [abs] : [];
      for (const file of files) {
        scanned += 1;
        const content = await safeRead(file);
        if (!content) continue;
        const result = scanForInjection(content);
        if (result.clean) continue;
        for (const f of result.findings) {
          findings.push({
            file: path.relative(rootDir, file),
            type: f.type,
            pattern: f.pattern,
            snippet: f.snippet,
            line: f.line,
            severity: SEVERITY_BY_TYPE[f.type] || "LOW",
          });
        }
      }
    }
  } catch (err) {
    if (logger?.warn) logger.warn(`injection-findings collector failed: ${err.message}`);
    return { available: false, reason: `collector failed: ${err.message}` };
  }
  return { available: true, scanned, total: findings.length, findings };
}

export function groupInjectionBySeverity(findings) {
  const groups = { HIGH: [], MEDIUM: [], LOW: [] };
  for (const f of findings || []) {
    const sev = (f.severity || "LOW").toUpperCase();
    if (groups[sev]) groups[sev].push(f);
    else groups.LOW.push(f);
  }
  return groups;
}

async function listFiles(dir, depth) {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFiles(abs, depth + 1);
      out.push(...nested);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

async function fileExists(file) {
  try {
    const s = await stat(file);
    return s.isFile();
  } catch {
    return false;
  }
}

async function safeRead(file) {
  try {
    const s = await stat(file);
    if (s.size > MAX_FILE_BYTES) return null;
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}
