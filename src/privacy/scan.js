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

// KJC-TSK-0797 (epic KJC-PCS-0082) — context BEFORE generics, measured twice:
// GREBLA's pinned Actions reported as phone numbers, and this repo's own
// workflow pinning flagged twelve times in one PR. A git object id is not a
// phone; an email on an RFC 2606 documentation domain is not a person. Both
// are blanked before redactPII and COUNTED, so a clean result can say
// "nothing found" or "found and discarded by context" — never the same thing.
// The personal denylist runs before this: the user's own datum always blocks.
// KJC-BUG-0195 — a Google key inside a Firebase web config is public by
// design: it names the project, and what protects the data are the Firestore
// rules. It still BLOCKS (the shape alone cannot prove which key it is, and a
// server key next to it would ride along), but the finding stops being a dead
// end: it names the declared way out, the allowlist, and what actually
// protects that key. A gate with no exit teaches people to skip the gate.
// Markers kept unambiguous on purpose (codex caught projectId being generic
// enough to appear next to a server key): only Firebase-specific ones count.
const FIREBASE_WEB_MARKERS = /firebaseConfig|authDomain|firebasestorage|firestore\.googleapis\.com|firebaseapp\.com/;
const FIREBASE_KEY_HINT = "si es la clave web de Firebase (publica por diseno): declarala en el allow de ~/.karajan/privacy.yml y restringela por dominio en la consola de Google";

// KJC-BUG-0329 (#2089): a lockfile dependency named *-token/*-auth/*-secret has a
// version for value. Only a WHOLE value made of versions (digits.x[.y], optional
// prerelease) joined by range operators is discarded (and counted); digits with
// no dot, or a version glued to text, are still a secret assignment.
// Prerelease and build metadata with the full SemVer charset (1.2.3-beta-1+build.5).
const SEMVER_TOKEN = String.raw`\d+\.(?:\d+|x|\*)(?:\.(?:\d+|x|\*))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
const SEMVER_OP = String.raw`(?:[\^~]|[<>]=?|=)`;
// Between two versions there is always an operator (||, a hyphen range, or a comparator).
const SEMVER_JOIN = String.raw`\s*(?:(?:\|\||-)\s*${SEMVER_OP}?|${SEMVER_OP})\s*`;
const SEMVER_VALUE = new RegExp(String.raw`^\s*${SEMVER_OP}?\s*${SEMVER_TOKEN}(?:${SEMVER_JOIN}${SEMVER_TOKEN})*\s*$`);

/** KJC-BUG-0380: a pair is discarded only when it is a real latitude, longitude. */
// KJC-TSK-1118: the test card numbers payment providers publish (Stripe, Braintree,
// Adyen, PayPal docs). Only these exact numbers; a card one digit away still warns.
const TEST_CARDS = new Set([
  "4242424242424242", "4000056655665556", "4111111111111111", "4012888888881881", "4000000000000002",
  "5555555555554444", "5105105105105100", "2223003122003222", "5200828282828210",
  "378282246310005", "371449635398431", "6011111111111117", "6011000990139424",
  "3056930009020004", "36227206271667", "3530111333300000", "3566002020360505",
]);
const isTestCard = (match) => TEST_CARDS.has(match.replaceAll(/[\s-]/g, ""));

function inGpsRange(_match, lat, lng) {
  return Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
}

const CONTEXT_DISCARDS = [
  { type: "git-sha", re: /\b(?:[0-9a-f]{64}|[0-9a-f]{40})\b/g },
  { type: "doc-domain-email", re: /\b[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)*(?:example\.(?:com|org|net)|test|invalid|localhost|example)\b/g },
  // KJC-BUG-0202: an HU Board id is `HU-<Date.now()>-<n>`, and Date.now() is
  // 13 digits — exactly a card's length, so every project using the default
  // board got a credit-card warning over its own card ids. The rule covers
  // the family (an alphabetic prefix, a dash, a long digit run: HU-…, KJC-…,
  // any tracker's) and NOTHING else.
  //
  // It deliberately does not go further, and it took three rejections to get
  // this narrow:
  //   1. discarding every card-shaped run that fails Luhn — wrong, a
  //      truncated or mistyped card also fails Luhn and is still sensitive;
  //   2. any alphabetic prefix — `card-4111111111111111` swallowed;
  //   3. any uppercase prefix with any digits — `CARD-4111111111111111-1`
  //      swallowed.
  // So the middle segment must be an actual millisecond timestamp: exactly 13
  // digits starting 16-19 (years 2022-2033). No card range begins with a 1
  // (Visa 4, Mastercard 2/5, Amex 3, Discover 6), so a card number cannot
  // occupy that slot at any length.
  { type: "tracker-id", re: /\b[A-Z]{2,6}-1[6-9]\d{11}-\d{1,4}\b/g },
  // KJC-BUG-0270: a rule id of the inventory (ADR 0016) is `R-` and 10 hex chars
  // of a hash, and .karajan/rules.yml is versioned: an id with a long run of
  // digits warned as a phone on every commit. Only the WHOLE shape is discarded:
  // exactly ten lowercase hex chars with at least one letter. An all-digit id
  // (about 1 in 100) still warns, because nothing tells it apart from a phone
  // written after "R-"; the allow list is the way out for that one.
  { type: "rule-id", re: /\bR-(?=\d*[a-f])[0-9a-f]{10}\b/g },
  // KJC-BUG-0317: a kj plan id is `plan-` + a YYYYMMDDHHMMSS stamp + `-` + 4
  // lowercase alphanumerics, also inside an HU id (hu_<planId>_007, hence the
  // lookarounds instead of \b). Only that WHOLE shape with a real 20xx date and
  // time: no card of 14 digits starts with 20 (Diners is 30/36/38), and a
  // 16-digit card does not fit the slot.
  // KJC-BUG-0380 (#2263): a latitude, longitude pair in test data read as a phone.
  // Only the WHOLE pair: both with a decimal point and four or more decimals, in
  // range (latitude up to 90, longitude up to 180), joined by a comma. A lone
  // number or a pair out of range still warns.
  { type: "gps-pair", re: /(?<![\d.])(-?\d{1,3}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?![\d.])/g, keep: inGpsRange },
  // KJC-TSK-1118: numbers reserved for fiction and tests, the good practice for test data.
  // NANP 555-0100..0199 (with an optional +1 and area code); Ofcom's drama ranges:
  // 07700 900xxx, 020 7946 0xxx and 01632 960xxx (0 or +44). Nothing around them.
  { type: "fictional-phone", re: /(?<![\d+])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?555[\s.-]?01\d{2}(?!\d)/g },
  { type: "fictional-phone-uk", re: /(?<![\d+])(?:\+44\s?|0)7700\s?900\d{3}(?!\d)/g },
  { type: "fictional-phone-uk", re: /(?<![\d+])(?:\+44\s?|0)20\s?7946\s?0\d{3}(?!\d)/g },
  { type: "fictional-phone-uk", re: /(?<![\d+])(?:\+44\s?|0)1632\s?960\d{3}(?!\d)/g },
  { type: "test-card", re: /(?<!\d)\d(?:[\s-]?\d){13,18}(?!\d)/g, keep: isTestCard },
  { type: "plan-id", re:/(?<![A-Za-z0-9])plan-20\d\d(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:[01]\d|2[0-3])[0-5]\d[0-5]\d-[a-z0-9]{4}(?![A-Za-z0-9])/g },
];

/**
 * Scan a text. Returns findings — denylist hits as `severity:"block"`
 * (masked value), generic PII as `severity:"warn"` (line already redacted).
 */
export function scanText(text, { list = loadPrivacyList(), source = "<text>" } = {}) {
  const findings = [];
  let discarded = 0;
  const firebaseWeb = FIREBASE_WEB_MARKERS.test(String(text));
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
        const hint = type === "google-key" && firebaseWeb ? ` — ${FIREBASE_KEY_HINT}` : "";
        findings.push({ severity: "block", type, source, line: i + 1, masked: `${maskValue(m[0])}${hint}` });
        probe = probe.slice(0, m.index) + " ".repeat(m[0].length) + probe.slice(m.index + m[0].length);
        re.lastIndex = m.index + m[0].length;
      }
    }
    for (const { type, re } of SECRET_HEURISTICS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(probe)) !== null) {
        if (type === "secret-assignment" && SEMVER_VALUE.test(m[1])) {
          discarded += 1;
          probe = probe.slice(0, m.index) + " ".repeat(m[0].length) + probe.slice(m.index + m[0].length);
          re.lastIndex = m.index + m[0].length;
          continue;
        }
        findings.push({ severity: "warn", type, source, line: i + 1, masked: `${maskValue(m[1])} — move it to .env or a secret manager` });
        probe = probe.slice(0, m.index) + " ".repeat(m[0].length) + probe.slice(m.index + m[0].length);
        re.lastIndex = m.index + m[0].length;
      }
    }
    for (const { re, keep } of CONTEXT_DISCARDS) {
      re.lastIndex = 0;
      probe = probe.replace(re, (m, ...groups) => {
        if (keep && !keep(m, ...groups)) return m;
        discarded += 1;
        return " ".repeat(m.length);
      });
    }
    const red = redactPII(probe);
    if (red.total > 0) {
      for (const [type, n] of Object.entries(red.counts)) {
        if (n > 0) findings.push({ severity: "warn", type, source, line: i + 1, masked: red.text.trim().slice(0, 120) });
      }
    }
  });
  findings.discardedByContext = discarded;
  return findings;
}

/** Scan files/dirs recursively (skips node_modules/.git, binaries, big files). */
export function scanPaths(paths, { list = loadPrivacyList() } = {}) {
  const findings = [];
  let discarded = 0;
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
    const fileFindings = scanText(content.toString("utf8"), { list, source: p });
    discarded += fileFindings.discardedByContext || 0;
    findings.push(...fileFindings);
  };
  for (const p of paths) visit(p);
  findings.discardedByContext = discarded;
  return findings;
}
