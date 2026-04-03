/**
 * Deterministic compressors for Bash command output.
 * Consolidated from: bash-git, bash-test, bash-build, bash-infra, bash-pkg, bash-misc.
 */
import { stripAnsi, collapseWhitespace, truncateLines } from "./utils.js";

// ── Git ──────────────────────────────────────────────────────────────────────

const GIT_PATTERNS = [
  /^On branch /m,
  /^(modified|deleted|new file|renamed):/m,
  /^Untracked files:/m,
  /^diff --git/m,
  /^commit [0-9a-f]{7,40}/m,
  /^(Changes to be committed|Changes not staged)/m,
  /^\* /m
];

function compactGitStatus(text) {
  const lines = text.split("\n");
  const kept = [];
  const branchLine = lines.find((l) => l.startsWith("On branch "));
  if (branchLine) kept.push(branchLine);
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^(modified|deleted|new file|renamed|both modified):/.test(trimmed) ||
      /^(Untracked files|Changes to be committed|Changes not staged)/.test(trimmed)
    ) {
      kept.push(trimmed);
    }
  }
  return kept.join("\n") || text;
}

function compactGitDiff(text) {
  const files = text.split(/(?=^diff --git)/m);
  const summaries = [];
  for (const file of files) {
    if (!file.trim()) continue;
    const header = file.match(/^diff --git a\/(.+?) b\/(.+)/m);
    const fname = header ? header[2] : "unknown";
    const additions = (file.match(/^\+(?!\+\+)/gm) || []).length;
    const deletions = (file.match(/^-(?!--)/gm) || []).length;
    const hunkHeaders = file.match(/^@@.*@@.*$/gm) || [];
    summaries.push(`${fname}: +${additions}/-${deletions} (${hunkHeaders.length} hunks)`);
    for (const h of hunkHeaders.slice(0, 3)) {
      summaries.push(`  ${h.trim()}`);
    }
  }
  return `git diff summary (${files.filter((f) => f.trim()).length} files):\n${summaries.join("\n")}`;
}

function compactGitLog(text) {
  const entries = text.split(/(?=^commit )/m).filter((e) => e.trim());
  const lines = [];
  for (const entry of entries) {
    const hashMatch = entry.match(/^commit ([0-9a-f]{7})/);
    const msgMatch = entry.match(/^\s{4}(.+)/m);
    const hash = hashMatch ? hashMatch[1] : "???????";
    const msg = msgMatch ? msgMatch[1].trim() : "(no message)";
    lines.push(`${hash} ${msg}`);
  }
  return truncateLines(lines.join("\n"), 30);
}

function compactGitBranch(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length <= 20) return lines.map((l) => l.trim()).join("\n");
  const current = lines.find((l) => l.startsWith("*"));
  return `${current ? current.trim() : "(detached)"}\n... (${lines.length} branches total)`;
}

function compactGit(text) {
  const clean = stripAnsi(text);
  if (/^On branch /m.test(clean) || /Changes (to be committed|not staged)/m.test(clean)) return compactGitStatus(clean);
  if (/^diff --git/m.test(clean)) return compactGitDiff(clean);
  if (/^commit [0-9a-f]{7,40}/m.test(clean)) return compactGitLog(clean);
  if (/^\* /m.test(clean) && clean.split("\n").every((l) => /^[\s*]/.test(l) || !l.trim())) return compactGitBranch(clean);
  return collapseWhitespace(clean);
}

// ── Test runners ─────────────────────────────────────────────────────────────

const TEST_PATTERNS = [
  /Tests?\s+\d+\s+(passed|failed)/i,
  /✓|✗|✘|PASS|FAIL/,
  /Test Suites?:/,
  /test result:/i,
  /FAILED|PASSED|ERROR/,
  /vitest|jest|mocha|playwright|pytest|cargo test|go test/i,
  /\d+ passing/,
  /\d+ failing/
];

function compactTest(text) {
  const clean = stripAnsi(text);
  const summaryPatterns = [
    /Tests?\s+\d+\s+(passed|failed).*/gi,
    /Test Suites?:.*$/gm,
    /\d+ passing.*$/gm,
    /\d+ failing.*$/gm,
    /test result:.*$/gim,
    /Tests:.*\d+ total$/gm
  ];

  const summaries = [];
  for (const p of summaryPatterns) {
    const matches = clean.match(p);
    if (matches) summaries.push(...matches.map((m) => m.trim()));
  }

  const failures = [];
  const failBlocks = clean.split(/(?=(?:FAIL|✗|✘|×)\s)/);
  for (const block of failBlocks) {
    if (/^(?:FAIL|✗|✘|×)\s/.test(block)) {
      failures.push(truncateLines(block.trim(), 8));
    }
  }

  const parts = [];
  if (summaries.length) parts.push(summaries.join("\n"));
  if (failures.length) parts.push(`Failed tests:\n${failures.join("\n---\n")}`);
  if (parts.length) return parts.join("\n\n");
  return truncateLines(collapseWhitespace(clean), 50);
}

// ── Build tools ──────────────────────────────────────────────────────────────

const BUILD_PATTERNS = [
  /error TS\d+:/,
  /\d+ errors?/i,
  /\d+ warnings?/i,
  /eslint/i,
  /prettier/i,
  /webpack/i,
  /✔|Built in|compiled/i,
  /Module Error|SyntaxError|TypeError/,
  /next build|vite build/i
];

function compactBuild(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n");
  const errors = [];
  const warnings = [];
  const summaries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/error TS\d+:|Error:|SyntaxError:|TypeError:|Module Error/i.test(trimmed)) {
      errors.push(trimmed);
    } else if (/warning|warn\b/i.test(trimmed) && !/node_modules/.test(trimmed)) {
      warnings.push(trimmed);
    } else if (/\d+ errors?|\d+ warnings?|compiled|Built in|✔|Found \d+/i.test(trimmed)) {
      summaries.push(trimmed);
    }
  }

  const parts = [];
  if (errors.length) parts.push(`Errors (${errors.length}):\n${truncateLines(errors.join("\n"), 20)}`);
  if (warnings.length) parts.push(`Warnings (${warnings.length}):\n${truncateLines(warnings.join("\n"), 10)}`);
  if (summaries.length) parts.push(summaries.join("\n"));
  if (parts.length) return parts.join("\n\n");
  return truncateLines(collapseWhitespace(clean), 40);
}

// ── Infrastructure ───────────────────────────────────────────────────────────

const INFRA_PATTERNS = [
  /CONTAINER ID/,
  /REPOSITORY\s+TAG/,
  /^NAME\s+READY\s+STATUS/m,
  /^(kubectl|docker|terraform)\s/m,
  /Terraform will perform/,
  /Plan:\s+\d+ to add/,
  /Apply complete/
];

function compactTable(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length <= 15) return lines.map((l) => collapseWhitespace(l)).join("\n");
  const header = lines[0];
  const rows = lines.slice(1, 11);
  return `${collapseWhitespace(header)}\n${rows.map((r) => collapseWhitespace(r)).join("\n")}\n... (${lines.length - 1} total rows)`;
}

function compactTerraform(text) {
  const lines = text.split("\n");
  const kept = [];
  for (const line of lines) {
    if (/Plan:|Apply complete|Terraform will perform|^\s*[#~+-]/.test(line) && !/Refreshing state/.test(line)) {
      kept.push(line.trim());
    }
  }
  return truncateLines(kept.join("\n"), 40) || truncateLines(collapseWhitespace(text), 30);
}

function compactInfra(text) {
  const clean = stripAnsi(text);
  if (/CONTAINER ID/.test(clean) || /REPOSITORY\s+TAG/.test(clean)) return compactTable(clean);
  if (/Terraform will perform|Plan:\s+\d+|Apply complete/.test(clean)) return compactTerraform(clean);
  if (/^NAME\s+READY\s+STATUS/m.test(clean)) return compactTable(clean);
  return truncateLines(collapseWhitespace(clean), 30);
}

// ── Package managers ─────────────────────────────────────────────────────────

const PKG_PATTERNS = [
  /added \d+ packages?/i,
  /npm warn|npm error/i,
  /packages? in \d/,
  /├──|└──|│/,
  /\d+ vulnerabilities/i,
  /npm outdated/i,
  /Current\s+Wanted\s+Latest/i
];

function compactPkg(text) {
  const clean = stripAnsi(text);
  if (/added \d+ packages?/i.test(clean)) {
    const lines = clean.split("\n");
    const kept = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/added \d+ packages?/i.test(trimmed) || /vulnerabilit/i.test(trimmed)) kept.push(trimmed);
    }
    return kept.join("\n") || clean;
  }
  if (/├──|└──/.test(clean)) return truncateLines(clean, 25);
  if (/Current\s+Wanted\s+Latest/i.test(clean)) return truncateLines(collapseWhitespace(clean), 20);
  return truncateLines(collapseWhitespace(clean), 30);
}

// ── Misc (curl, gh, npx) ────────────────────────────────────────────────────

const MISC_PATTERNS = [
  /HTTP\/[\d.]+\s+\d{3}/,
  /curl:|wget:/i,
  /gh (pr|issue|repo|release)/i,
  /npx:/i
];

function compactHttp(text) {
  const lines = text.split("\n");
  const kept = [];
  for (const line of lines) {
    if (
      /HTTP\/[\d.]+\s+\d{3}/.test(line) ||
      /^(content-type|location|x-[-\w]+|authorization):/i.test(line.trim())
    ) {
      kept.push(line.trim());
    }
  }
  const bodyStart = text.indexOf("\r\n\r\n");
  if (bodyStart > -1) {
    const body = text.slice(bodyStart + 4).trim();
    if (body) kept.push(truncateLines(body, 20));
  }
  return kept.join("\n") || truncateLines(collapseWhitespace(text), 30);
}

function compactMisc(text) {
  const clean = stripAnsi(text);
  if (/HTTP\/[\d.]+\s+\d{3}/.test(clean)) return compactHttp(clean);
  if (/gh (pr|issue|repo|release)/i.test(clean)) return truncateLines(collapseWhitespace(clean), 20);
  return truncateLines(collapseWhitespace(clean), 40);
}

// ── Registry ─────────────────────────────────────────────────────────────────

function makeLooksLike(patterns) {
  return (text) => {
    const clean = stripAnsi(text);
    return patterns.some((p) => p.test(clean));
  };
}

/**
 * Ordered list of bash compressors. Tried in sequence; first match wins.
 * Order matters: more specific patterns (git, test) before generic (misc).
 */
export const BASH_COMPRESSORS = [
  { name: "git", looksLike: makeLooksLike(GIT_PATTERNS), compact: compactGit },
  { name: "test", looksLike: makeLooksLike(TEST_PATTERNS), compact: compactTest },
  { name: "build", looksLike: makeLooksLike(BUILD_PATTERNS), compact: compactBuild },
  { name: "infra", looksLike: makeLooksLike(INFRA_PATTERNS), compact: compactInfra },
  { name: "pkg", looksLike: makeLooksLike(PKG_PATTERNS), compact: compactPkg },
  { name: "misc", looksLike: makeLooksLike(MISC_PATTERNS), compact: compactMisc }
];
