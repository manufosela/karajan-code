/**
 * `kj privacy scan` (KJC-TSK-0704) — audit an outbound boundary before it
 * ships: files/dirs or the staged diff's ADDED lines. Denylist blocks
 * (exit 1), generic PII warns; findings always come out masked.
 */
import { runCommand } from "../utils/process.js";
import { loadPrivacyList, scanPaths, scanText, privacyConfigPath } from "../privacy/scan.js";

const addedLines = (diff) =>
  diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");

export async function privacyScanCommand({ paths = [], flags = {}, logger = console } = {}) {
  const list = loadPrivacyList();
  let findings;
  if (flags.staged) {
    const res = await runCommand("git", ["diff", "--cached", "--no-ext-diff", "--unified=0"]);
    findings = scanText(addedLines(res.stdout || ""), { list, source: "<staged diff>" });
  } else {
    if (paths.length === 0) {
      logger.error?.("kj privacy scan: pass one or more paths, or --staged");
      process.exitCode = 2;
      return { ok: false, findings: [] };
    }
    findings = scanPaths(paths, { list });
  }

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
  const context = discarded > 0 ? `; ${discarded} candidate(s) discarded by context — git SHAs / documentation domains` : "";
  logger.info?.(ok
    ? `privacy scan: clean of denylist hits (${warns.length} generic warning(s)${context})`
    : `privacy scan: ${blocks.length} personal-data hit(s) — this must not ship`);
  return { ok, findings };
}
