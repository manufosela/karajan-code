/**
 * kj audit --agent-readiness — score a repo for AI-agent readability.
 *
 * Static, deterministic, NO LLM call. Inspired by addyosmani/agentic-seo.
 * Catches the failure modes that make repos invisible to Cursor /
 * Cline / Aider / Claude Code:
 *   - no llms.txt → agents have to crawl the README
 *   - oversized doc pages → agents truncate or drop them
 *   - JS-only docs → agents can't render
 *   - broken heading hierarchy → agents misinfer structure
 *   - no robots allowlist → some agents skip silently
 *
 * Returns a 0-100 score + per-check detail + top remediation hints.
 * Pure data transformation: filesystem reads in, analysis out.
 */

import fs from "node:fs";
import path from "node:path";

const PAGE_BYTE_LIMIT = 32 * 1024; // ≈ 8K tokens, the typical agent budget per fetch

/**
 * Catalogue of checks. Each check has:
 *   - id          — stable identifier
 *   - weight      — points contributed when ok
 *   - run         — (rootDir) => { ok, hint, details }
 */
const CHECKS = [
  {
    id: "llms-txt-present",
    weight: 25,
    description: "llms.txt at repo root",
    run(rootDir) {
      const p = path.join(rootDir, "llms.txt");
      const ok = fs.existsSync(p) && fs.statSync(p).isFile();
      return ok
        ? { ok: true, hint: null, details: { path: p } }
        : { ok: false, hint: "Add llms.txt at repo root with a single-fetch index of docs + commands.", details: {} };
    },
  },
  {
    id: "llms-txt-valid",
    weight: 10,
    description: "llms.txt has at least one section heading and one link",
    run(rootDir) {
      const p = path.join(rootDir, "llms.txt");
      if (!fs.existsSync(p)) return { ok: false, hint: "llms.txt missing — see llms-txt-present.", details: {} };
      const text = safeRead(p);
      const hasSection = /^##\s+/m.test(text);
      const hasLink = /\[[^\]]+\]\([^)]+\)/.test(text);
      const ok = hasSection && hasLink;
      return ok
        ? { ok: true, hint: null, details: { hasSection, hasLink } }
        : { ok: false, hint: "Add `## Section` headings and `[label](path)` links to llms.txt.", details: { hasSection, hasLink } };
    },
  },
  {
    id: "robots-allowlist",
    weight: 10,
    description: "robots.txt explicitly Allows AI crawlers",
    run(rootDir) {
      // Check root or public/.
      const candidates = ["robots.txt", "public/robots.txt", "static/robots.txt"];
      const found = candidates.find((c) => fs.existsSync(path.join(rootDir, c)));
      if (!found) return { ok: false, hint: "Add robots.txt with `User-agent: GPTBot|ClaudeBot|PerplexityBot\\nAllow: /` blocks.", details: {} };
      const text = safeRead(path.join(rootDir, found));
      const aiBots = ["GPTBot", "ClaudeBot", "PerplexityBot", "anthropic-ai", "Google-Extended"];
      const allowed = aiBots.filter((bot) => new RegExp(`User-agent:\\s*${bot}[\\s\\S]*?Allow:\\s*/`, "i").test(text));
      const ok = allowed.length > 0;
      return ok
        ? { ok: true, hint: null, details: { found, allowed } }
        : { ok: false, hint: `robots.txt found at ${found} but no AI crawler explicitly Allowed. Add explicit User-agent: ClaudeBot blocks.`, details: { found, allowed } };
    },
  },
  {
    id: "page-token-budget",
    weight: 15,
    description: "every .md doc fits within ≈ 8K tokens (32 KB raw)",
    run(rootDir) {
      const docsDir = path.join(rootDir, "docs");
      if (!fs.existsSync(docsDir)) {
        // No docs/ at all is its own kind of agent-unfriendly, but
        // not strictly a budget violation. Pass with a hint.
        return { ok: true, hint: "No docs/ directory found. Consider adding one.", details: { docsDirPresent: false } };
      }
      const oversized = listMarkdownFiles(docsDir).filter((f) => fs.statSync(f).size > PAGE_BYTE_LIMIT);
      if (oversized.length === 0) {
        return { ok: true, hint: null, details: { oversizedCount: 0 } };
      }
      const sample = oversized.slice(0, 3).map((f) => `${path.relative(rootDir, f)} (${(fs.statSync(f).size / 1024).toFixed(1)} KB)`);
      return {
        ok: false,
        hint: `Split or trim ${oversized.length} oversized doc(s): ${sample.join(", ")}.`,
        details: { oversizedCount: oversized.length, sample },
      };
    },
  },
  {
    id: "heading-hierarchy",
    weight: 10,
    description: "each .md has exactly one H1 and no skipped levels",
    run(rootDir) {
      const docsDir = path.join(rootDir, "docs");
      if (!fs.existsSync(docsDir)) return { ok: true, hint: null, details: { docsDirPresent: false } };
      const violations = [];
      for (const f of listMarkdownFiles(docsDir)) {
        const text = stripFencedCodeBlocks(safeRead(f));
        // Count BOTH markdown `# ` and HTML `<h1>` headings — bilingual
        // README-style files often use a centered `<h1 align="center">`
        // banner, which is still semantically the document's H1.
        const mdH1Count = (text.match(/^#\s+/gm) || []).length;
        const htmlH1Count = (text.match(/<h1[\s>]/gi) || []).length;
        const h1Count = mdH1Count + htmlH1Count;
        if (h1Count !== 1) {
          violations.push({ file: path.relative(rootDir, f), h1Count, mdH1Count, htmlH1Count });
          continue;
        }
        // Check for skipped levels (#### without preceding ###, etc.)
        const headings = [...text.matchAll(/^(#{1,6})\s/gm)].map((m) => m[1].length);
        let prev = 0;
        for (const lvl of headings) {
          if (prev > 0 && lvl > prev + 1) {
            violations.push({ file: path.relative(rootDir, f), reason: `H${prev}→H${lvl} skip` });
            break;
          }
          prev = lvl;
        }
      }
      if (violations.length === 0) {
        return { ok: true, hint: null, details: { violationsCount: 0 } };
      }
      const sample = violations.slice(0, 3);
      return {
        ok: false,
        hint: `Fix heading hierarchy in ${violations.length} doc(s): ${sample.map((v) => v.file).join(", ")}.`,
        details: { violationsCount: violations.length, sample },
      };
    },
  },
  {
    id: "agents-readme",
    weight: 10,
    description: "docs/agents/README.md as agent entry point",
    run(rootDir) {
      const p = path.join(rootDir, "docs/agents/README.md");
      const ok = fs.existsSync(p);
      return ok
        ? { ok: true, hint: null, details: { path: p } }
        : { ok: false, hint: "Create docs/agents/README.md as the agent-facing index (links from llms.txt).", details: {} };
    },
  },
  {
    id: "skill-md-coverage",
    weight: 20,
    description: "at least one SKILL.md per declared CLI capability",
    run(rootDir) {
      const skillDir = path.join(rootDir, "docs/agents");
      if (!fs.existsSync(skillDir)) return { ok: false, hint: "Create docs/agents/ with one SKILL.<command>.md per CLI capability.", details: {} };
      const skillFiles = fs.readdirSync(skillDir).filter((f) => /^SKILL\..+\.md$/.test(f));
      if (skillFiles.length === 0) {
        return { ok: false, hint: "Add SKILL.<command>.md files documenting each CLI capability.", details: { skillFilesCount: 0 } };
      }
      // We don't enumerate the user's own CLI here (out of scope for a
      // generic auditor). At least 1 SKILL.md is the minimum signal.
      return { ok: true, hint: null, details: { skillFilesCount: skillFiles.length } };
    },
  },
];

function safeRead(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

/**
 * Replace every fenced code block (```…``` or ~~~…~~~) with blank lines
 * of the same line count so heading regexes don't accidentally match
 * shell comments inside bash code blocks (`# install foo`). Preserving
 * line counts keeps later byte-offset checks stable.
 */
function stripFencedCodeBlocks(text) {
  return text.replaceAll(/^([ \t]*)(```|~~~)[^\n]*\n([\s\S]*?)\n\1\2[^\n]*$/gm, (match) => {
    const lineCount = match.split("\n").length;
    return "\n".repeat(lineCount - 1);
  });
}

function listMarkdownFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listMarkdownFiles(p, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/**
 * Run every agent-readiness check against `rootDir`. Returns a
 * report with score, per-check results, and ranked remediation hints.
 *
 * @param {string} rootDir — absolute path to the repo root to audit
 * @returns {{ score: number, checks: object[], topFixes: object[] }}
 */
export function runAgentReadiness(rootDir) {
  const checks = [];
  let earned = 0;
  let possible = 0;
  for (const c of CHECKS) {
    possible += c.weight;
    let result;
    try {
      result = c.run(rootDir);
    } catch (err) {
      result = { ok: false, hint: `Check threw: ${err.message}`, details: { error: err.message } };
    }
    if (result.ok) earned += c.weight;
    checks.push({
      id: c.id,
      description: c.description,
      weight: c.weight,
      score: result.ok ? c.weight : 0,
      ok: result.ok,
      hint: result.hint,
      details: result.details || {},
    });
  }
  const score = possible === 0 ? 0 : Math.round((earned / possible) * 100);
  const topFixes = checks
    .filter((c) => !c.ok && c.hint)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((c, i) => ({
      priority: i + 1,
      checkId: c.id,
      weightLost: c.weight,
      action: c.hint,
    }));
  return { score, possible, earned, checks, topFixes };
}

/**
 * Render the report in plain text for the human terminal.
 */
export function formatAgentReadinessReport({ score, checks, topFixes }, rootDir) {
  const lines = [`Agent Readiness — ${rootDir}: ${score}/100`, ""];
  for (const c of checks) {
    const tick = c.ok ? "✓" : "✗";
    const pts = `(+${c.score})`.padStart(6);
    lines.push(`  ${tick} ${c.description.padEnd(50)} ${pts}${c.hint ? "  " + c.hint : ""}`);
  }
  if (topFixes.length > 0) {
    lines.push("", "Top fixes:");
    for (const f of topFixes) {
      lines.push(`  ${f.priority}. [${f.checkId}] ${f.action}`);
    }
  }
  return lines.join("\n");
}
