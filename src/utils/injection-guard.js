/**
 * Prompt-injection guard for AI-reviewed diffs and PR content.
 *
 * Scans text for patterns commonly used to hijack LLM instructions:
 * directive overrides, role reassignment, invisible Unicode, and
 * suspiciously large comment blocks that could hide payloads.
 *
 * @module utils/injection-guard
 */

/** Phrases that attempt to override system/reviewer instructions. */
const DIRECTIVE_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?|guidelines?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|rules?|context)/i,
  /override\s+(the\s+)?(system|reviewer|review)\s+(prompt|instructions?|rules?)/i,
  /do\s+not\s+follow\s+(the\s+)?(above|previous|system)\s+(instructions?|rules?)/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*you\s+are/i,
  /\bact\s+as\s+(a\s+)?(different|new|my|an?\s+)/i,
  /you\s+are\s+now\s+(a\s+)?/i,
  /from\s+now\s+on\s*(,|\s)?\s*you\s+(will|should|must|are)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /respond\s+(only\s+)?with\s+["']?approved["']?/i,
  /always\s+(return|respond|output)\s+.*approved/i,
  /set\s+approved\s*[=:]\s*true/i,
  /\bapproved["']?\s*:\s*true\b.*ignore/i,
  /output\s+the\s+following\s+json/i,
  /return\s+this\s+exact\s+(json|response|output)/i,
];

/** Unicode categories that can hide or disguise content. */
const UNICODE_PATTERNS = [
  /[\u200B-\u200F]/,   // zero-width spaces, LTR/RTL marks
  /[\u202A-\u202E]/,   // bidi embedding/override
  /[\u2066-\u2069]/,   // bidi isolate
  /[\uFEFF]/,          // BOM mid-text
  /[\u00AD]{3,}/,      // repeated soft hyphens
  /[\u2060-\u2064]/,   // invisible operators
  /[\u{E0000}-\u{E007F}]/u, // tag characters
];

/** Maximum comment block size (chars) before flagging. */
const MAX_COMMENT_BLOCK = 2000;

/**
 * Comment block patterns for common languages.
 * Each regex captures the full block content.
 */
const COMMENT_BLOCK_RE = [
  /\/\*[\s\S]{0,20000}?\*\//g,        // C-style /* ... */
  /<!--[\s\S]{0,20000}?-->/g,         // HTML <!-- ... -->
  /"""\s*[\s\S]{0,20000}?\s*"""/g,    // Python docstrings
  /'''\s*[\s\S]{0,20000}?\s*'''/g,    // Python docstrings (single)
  /=begin[\s\S]{0,20000}?=end/g,      // Ruby block comments
];

/**
 * @typedef {Object} InjectionFinding
 * @property {"directive"|"unicode"|"comment_block"} type
 * @property {string} pattern  - short label of what matched
 * @property {string} snippet  - excerpt of the offending text (max 120 chars)
 * @property {number} [line]   - approximate line number (1-based)
 */

/**
 * @typedef {Object} GuardResult
 * @property {boolean} clean        - true if no threats detected
 * @property {InjectionFinding[]} findings
 * @property {string} summary       - human-readable one-liner
 */

/**
 * Scan a text (diff, PR description, comment) for prompt-injection signals.
 *
 * @param {string} text - content to scan
 * @param {Object} [opts]
 * @param {number} [opts.maxCommentBlock=2000] - flag comment blocks larger than this
 * @returns {GuardResult}
 */
export function scanForInjection(text, opts = {}) {
  if (!text || typeof text !== "string") {
    return { clean: true, findings: [], summary: "Nothing to scan" };
  }

  const maxBlock = opts.maxCommentBlock ?? MAX_COMMENT_BLOCK;
  /** @type {InjectionFinding[]} */
  const findings = [];

  // 1. Directive patterns
  for (const re of DIRECTIVE_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      findings.push({
        type: "directive",
        pattern: re.source.slice(0, 60),
        snippet: excerpt(text, match.index),
        line: lineAt(text, match.index),
      });
    }
  }

  // 2. Invisible Unicode
  for (const re of UNICODE_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      const charCode = match[0].codePointAt(0).toString(16).toUpperCase();
      findings.push({
        type: "unicode",
        pattern: `U+${charCode}`,
        snippet: excerpt(text, match.index),
        line: lineAt(text, match.index),
      });
    }
  }

  // 3. Oversized comment blocks
  for (const re of COMMENT_BLOCK_RE) {
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length > maxBlock) {
        findings.push({
          type: "comment_block",
          pattern: `block ${m[0].length} chars (max ${maxBlock})`,
          snippet: excerpt(text, m.index),
          line: lineAt(text, m.index),
        });
      }
    }
  }

  const clean = findings.length === 0;
  const summary = clean
    ? "No injection patterns detected"
    : `${findings.length} potential injection(s): ${[...new Set(findings.map((f) => f.type))].join(", ")}`;

  return { clean, findings, summary };
}

/**
 * Scan a git diff, focusing only on added lines (lines starting with +).
 * Removed lines cannot inject into the AI prompt.
 *
 * @param {string} diff - unified diff content
 * @param {Object} [opts]
 * @returns {GuardResult}
 */
export function scanDiff(diff, opts = {}) {
  if (!diff) return { clean: true, findings: [], summary: "Empty diff" };

  // Split diff into per-file chunks to avoid false positives from
  // concatenated added-lines across unrelated files.
  const files = diff.split(/^diff --git /m).filter(Boolean);

  const allFindings = [];
  for (const fileChunk of files) {
    const addedLines = fileChunk
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join("\n");

    if (!addedLines) continue;
    const result = scanForInjection(addedLines, opts);
    if (!result.clean) allFindings.push(...result.findings);
  }

  const clean = allFindings.length === 0;
  return {
    clean,
    findings: allFindings,
    summary: clean ? "No injection patterns detected" : `${allFindings.length} injection pattern(s) detected across diff`
  };
}

// --- Helpers ---

function excerpt(text, index) {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + 100);
  return text.slice(start, end).replace(/\n/g, "\\n").slice(0, 120);
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}
