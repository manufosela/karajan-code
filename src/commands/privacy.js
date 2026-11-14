/**
 * `kj privacy scan` (KJC-TSK-0704) — audit an outbound boundary before it
 * ships: files/dirs, the staged diff's ADDED lines or, KJC-TSK-1556, a commit
 * range's (`--range`, which also blocks on the output guard's credential shapes). Denylist blocks
 * (exit 1), generic PII warns; findings always come out masked.
 */
import { runCommand } from "../utils/process.js";
import { loadPrivacyList, scanPaths, scanText, privacyConfigPath } from "../privacy/scan.js";
import { CREDENTIAL_PATTERNS, extractAddedLines, scanDiff } from "../guards/output-guard.js";
import { loadConfig } from "../config.js";
import { rangeIsOnlySeals } from "../review/seal-commit.js";

const SEAL_ONLY = "privacy scan: the range only brings the signed seal (kj harden --commit), verified against the roster; nothing to scan";

const CREDENTIAL_IDS = new Set(CREDENTIAL_PATTERNS.map((p) => p.id));

const addedLines = (diff) =>
  diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");

const defaultKjConfig = async (dir) => (await loadConfig(dir)).config;

const fail = (logger, message) => {
  logger.error?.(message);
  process.exitCode = 2;
  return { ok: false, findings: [] };
};

/** KJC-TSK-1556: what the flags cannot mean together, or null when they are coherent. */
function usageError(paths, { range, staged }) {
  if (range && staged) return "kj privacy scan: --range and --staged are exclusive";
  if (range && paths.length > 0) return "kj privacy scan: --range takes no paths, it scans the range's added lines";
  if (range && String(range).startsWith("-")) return `kj privacy scan: --range must be a revision range, not ${range}`;
  if (!range && !staged && paths.length === 0) return "kj privacy scan: pass one or more paths, --staged or --range <rev-range>";
  return null;
}

/**
 * The output guard's credential shapes, as `secretsCheck` reads them; an assignment the
 * project declared in guards.output.non_secret_assignments is no longer critical, so it drops.
 * The matched value never leaves: the rule's message stands in for it.
 */
function credentialFindings(diff, config) {
  return scanDiff(diff, config).violations
    .filter((v) => CREDENTIAL_IDS.has(v.id) && v.severity === "critical")
    .map((v) => ({ severity: "block", type: v.id, source: v.file, line: v.line, masked: `*** ${v.message}` }));
}

/** The PII scan of --staged, per file, with each finding on the file's real line. */
function piiFindings(diff, list) {
  let discarded = 0;
  const byFile = Object.groupBy(extractAddedLines(diff), (a) => a.file);
  const found = Object.entries(byFile).flatMap(([file, lines]) => {
    const hits = scanText(lines.map((l) => l.content).join("\n"), { list, source: file });
    discarded += hits.discardedByContext || 0;
    return hits.map((f) => ({ ...f, line: lines[f.line - 1].line }));
  });
  found.discardedByContext = discarded;
  return found;
}

async function rangeFindings(range, { cwd, list, loadKjConfig }) {
  const res = await runCommand("git", ["diff", "--no-ext-diff", range, "--"], { cwd });
  if (res.exitCode !== 0) throw new Error(`git diff ${range} failed: ${(res.stderr || "").trim()}`);
  const diff = res.stdout || "";
  const pii = piiFindings(diff, list);
  const found = [...credentialFindings(diff, await loadKjConfig(cwd)), ...pii];
  found.discardedByContext = pii.discardedByContext;
  return found;
}

async function collectFindings(paths, flags, ctx) {
  if (flags.range) return rangeFindings(flags.range, ctx);
  if (!flags.staged) return scanPaths(paths, { list: ctx.list });
  const res = await runCommand("git", ["diff", "--cached", "--no-ext-diff", "--unified=0"]);
  return scanText(addedLines(res.stdout || ""), { list: ctx.list, source: "<staged diff>" });
}

export async function privacyScanCommand({ paths = [], flags = {}, logger = console, cwd = process.cwd(), loadKjConfig = defaultKjConfig } = {}) {
  const usage = usageError(paths, flags);
  if (usage) return fail(logger, usage);
  let list, findings;
  try {
    list = loadPrivacyList(); // HU-3727: a corrupt privacy.yml is an error, never "no denylist"
    // KJC-BUG-0590: the owner's signed act passes this judge as it passes verify-pr.
    if (flags.range && (await rangeIsOnlySeals({ projectDir: cwd, range: flags.range, run: runCommand }))) return sealOnly(flags, logger);
    findings = await collectFindings(paths, flags, { cwd, list, loadKjConfig });
  } catch (err) {
    return fail(logger, err.message);
  }
  return report(findings, list, flags, logger);
}

function sealOnly(flags, logger) {
  process.exitCode = 0;
  if (flags.json) process.stdout.write(`${JSON.stringify({ ok: true, sealOnly: true, blocks: 0, warns: 0, discardedByContext: 0, findings: [] })}\n`);
  else logger.info?.(SEAL_ONLY);
  return { ok: true, findings: [] };
}

function report(findings, list, flags, logger) {
  const blocks = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");
  const ok = blocks.length === 0;
  process.exitCode = ok ? 0 : 1;
  // KJC-TSK-0797 AC4: "nothing found" and "found but explained by context"
  // are different truths — the report says which one it is.
  const discarded = findings.discardedByContext || 0;
  // --json keeps stdout machine-clean: exactly one JSON document, no prose.
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok, blocks: blocks.length, warns: warns.length, discardedByContext: discarded, findings })}\n`);
    return { ok, findings };
  }
  for (const f of blocks) logger.error?.(`✗ BLOCK [${f.type}] ${f.source}:${f.line} → ${f.masked}`);
  for (const f of warns) logger.warn?.(`⚠ warn [${f.type}] ${f.source}:${f.line} → ${f.masked}`);
  if (!list.present) {
    logger.info?.(`hint: no personal denylist found — create ${privacyConfigPath()} (personal: [...], allow: [...]) so YOUR data blocks, not just warns`);
  }
  const skippedBinary = findings.skippedBinary || 0;
  if (skippedBinary > 0) logger.info?.(`kj privacy scan: ${skippedBinary} binary file(s) not read (NUL bytes)`);
  const context = discarded > 0 ? `; ${discarded} candidate(s) discarded by context — git SHAs / documentation domains` : "";
  logger.info?.(ok
    ? `privacy scan: clean of denylist hits (${warns.length} generic warning(s)${context})`
    : `privacy scan: ${blocks.length} blocking hit(s) (personal data or credentials) — this must not ship`);
  return { ok, findings };
}
