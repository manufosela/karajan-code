/**
 * privacy — the outbound boundary scanner (KJC-TSK-0704, epic KJC-PCS-0070).
 * Born from a real incident (personal emails published on a landing):
 * outputs get sanitized at boundaries like inputs do. Engine: karajan-rag's
 * audited redactPII line by line — detects AND masks in one pass, so a
 * finding never echoes the datum. On top, the user's denylist from
 * `~/.karajan/privacy.yml` — GLOBAL, never in a repo: the list is sensitive.
 */

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { redactPII } from "karajan-rag";

const SKIP_DIRS = new Set(["node_modules", ".git", ".kj"]);
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tgz", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".db", ".sqlite"]);
const MAX_FILE_BYTES = 512 * 1024;

export function privacyConfigPath(home = os.homedir()) {
  // KJ_PRIVACY_CONFIG: test/CI override of the global denylist location.
  return process.env.KJ_PRIVACY_CONFIG || join(home, ".karajan", "privacy.yml");
}

/** Personal denylist + public-identity allowlist. Absent file → generics only. */
export function loadPrivacyList({ home = os.homedir() } = {}) {
  try {
    const raw = parseYaml(readFileSync(privacyConfigPath(home), "utf8")) || {};
    const clean = (xs) => (Array.isArray(xs) ? xs.map(String).map((s) => s.trim()).filter(Boolean) : []);
    return { personal: clean(raw.personal), allow: clean(raw.allow), present: true };
  } catch {
    return { personal: [], allow: [], present: false };
  }
}

const maskValue = (v) => (v.length <= 4 ? "***" : `${v.slice(0, 2)}***${v.slice(-2)}`);

// KJC-TSK-0708 — hardcoded secrets. Known token shapes are never legit in
// an outbound artifact → block; heuristics (credential assignments and
// user:pass@ connection strings) warn toward .env / a secret manager.
const SECRET_SHAPES = [
  { type: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { type: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { type: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: "google-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { type: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
];
const SECRET_HEURISTICS = [
  { type: "secret-assignment", re: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|auth)["']?\s*[:=]\s*["']([^"']{6,})["']/gi },
  { type: "conn-string", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/gi },
];

/**
 * Scan a text. Returns findings — denylist hits as `severity:"block"`
 * (masked value), generic PII as `severity:"warn"` (line already redacted).
 */
export function scanText(text, { list = loadPrivacyList(), source = "<text>" } = {}) {
  const findings = [];
  String(text).split("\n").forEach((line, i) => {
    let probe = line;
    for (const a of list.allow) probe = probe.split(a).join(" ");
    for (const p of list.personal) {
      let at = probe.toLowerCase().indexOf(p.toLowerCase());
      if (at === -1) continue;
      findings.push({ severity: "block", type: "denylist", source, line: i + 1, masked: maskValue(p) });
      // Blank every occurrence so the generics don't double-report it.
      while (at !== -1) { probe = probe.slice(0, at) + " ".repeat(p.length) + probe.slice(at + p.length); at = probe.toLowerCase().indexOf(p.toLowerCase()); }
    }
    for (const { type, re } of SECRET_SHAPES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(probe)) !== null) {
        findings.push({ severity: "block", type, source, line: i + 1, masked: maskValue(m[0]) });
        probe = probe.slice(0, m.index) + " ".repeat(m[0].length) + probe.slice(m.index + m[0].length);
        re.lastIndex = m.index + m[0].length;
      }
    }
    for (const { type, re } of SECRET_HEURISTICS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(probe)) !== null) {
        findings.push({ severity: "warn", type, source, line: i + 1, masked: `${maskValue(m[1])} — move it to .env or a secret manager` });
        probe = probe.slice(0, m.index) + " ".repeat(m[0].length) + probe.slice(m.index + m[0].length);
        re.lastIndex = m.index + m[0].length;
      }
    }
    const red = redactPII(probe);
    if (red.total > 0) {
      for (const [type, n] of Object.entries(red.counts)) {
        if (n > 0) findings.push({ severity: "warn", type, source, line: i + 1, masked: red.text.trim().slice(0, 120) });
      }
    }
  });
  return findings;
}

/** Scan files/dirs recursively (skips node_modules/.git, binaries, big files). */
export function scanPaths(paths, { list = loadPrivacyList() } = {}) {
  const findings = [];
  const visit = (p) => {
    if (!existsSync(p)) return;
    // Skip symlinks: an ancestor link recurses forever; an outside link ships nothing.
    const st = lstatSync(p);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) {
        if (!SKIP_DIRS.has(name)) visit(join(p, name));
      }
      return;
    }
    if (BINARY_EXT.has(extname(p).toLowerCase()) || st.size > MAX_FILE_BYTES) return;
    const content = readFileSync(p);
    if (content.includes(0)) return; // binary sniff: NUL byte
    findings.push(...scanText(content.toString("utf8"), { list, source: p }));
  };
  for (const p of paths) visit(p);
  return findings;
}
