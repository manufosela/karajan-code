/**
 * KJC-TSK-1077: the security and privacy requirements of a third-party PR,
 * with no tokens. Each check is {id, ok, detail} and never stops the review.
 * They reuse the scanners kj applies to its own work: the output guard's
 * credential patterns, the privacy scan, the prompt-injection catalog, the
 * supply-chain cooldown and semgrep, limited to the PR's files.
 */
import { CREDENTIAL_PATTERNS, scanDiff as scanGuards } from "../guards/output-guard.js";
import { scanDiff as scanInjection } from "../utils/injection-guard.js";
import { loadPrivacyList, scanText } from "../privacy/scan.js";
import { isGeneratedPath, splitAddedByFile } from "../privacy/diff-scope.js";
import { collectSemgrepFindings } from "../audit/semgrep-findings.js";
import { cooldownAdvisories } from "./dep-cooldown.js";
import path from "node:path";
import { repoPrivacyPolicy, withRepoAllow } from "./repo-privacy.js";

const CREDENTIAL_IDS = new Set(CREDENTIAL_PATTERNS.map((p) => p.id));
const BLOCKING_SEMGREP = new Set(["ERROR", "WARNING"]);
const check = (id, problems, okDetail) => (problems.length
  ? { id, ok: false, detail: problems.join("; ") }
  : { id, ok: true, detail: okDetail });

/** Credentials in added lines (AWS, private keys, tokens, URLs with passwords...). */
export function secretsCheck(diff, config) {
  const found = scanGuards(diff, config).violations.filter((v) => CREDENTIAL_IDS.has(v.id));
  return check("secrets", found.map((v) => `${v.file}:${v.line} ${v.id}`), "no secrets in the added lines");
}

/**
 * Personal data in added lines, masked. Generated output and, KJC-TSK-1152, the repo's
 * test paths keep only blocking hits (denylist, secret shapes); test-path discards are counted.
 */
export function privacyCheck(diff, { list = loadPrivacyList(), testPaths = [] } = {}) {
  let discarded = 0;
  const found = splitAddedByFile(diff).flatMap(({ file, added }) => {
    const hits = scanText(added, { list, source: file });
    const inTests = testPaths.some((glob) => path.matchesGlob(file, glob));
    if (!inTests && !isGeneratedPath(file)) return hits;
    const kept = hits.filter((f) => f.severity === "block");
    if (inTests) discarded += hits.length - kept.length;
    return kept;
  });
  const res = check("privacy", found.map((f) => `${f.source}:${f.line} ${f.type} ${f.masked}`), "no personal data in the added lines");
  return discarded ? { ...res, detail: `${res.detail} (${discarded} generic finding(s) discarded in test paths)` } : res;
}

/** Prompt-injection patterns in the added lines (text an AI will read). */
export function injectionCheck(diff) {
  const res = scanInjection(diff);
  return check("prompt-injection", res.clean ? [] : [res.summary], "no prompt-injection patterns");
}

/** Dependencies the lockfile adds that were published under the threshold. */
export async function cooldownCheck(diff, { advisories = cooldownAdvisories, thresholdHours } = {}) {
  const { young = [], unverified = [], skipped = 0 } = await advisories(diff, thresholdHours ? { thresholdHours } : {});
  const problems = young.map((p) => `${p.name}@${p.version} published ${p.hours} h ago`);
  const notes = [...unverified.map((p) => `${p.name}@${p.version} unverified`), ...(skipped ? [`${skipped} packages changed, none checked`] : [])];
  const res = check("dependency-cooldown", problems, "no dependency published in the last hours");
  return notes.length ? { ...res, detail: `${res.detail} (${notes.join("; ")})` } : res;
}

/** semgrep (the static part of kj audit --security), counted on the PR's files only. */
export async function semgrepCheck({ projectDir, files, collect = collectSemgrepFindings }) {
  const res = await collect(projectDir);
  if (!res.available) return { id: "semgrep", ok: true, detail: `not available: ${res.reason}` };
  const inPr = new Set(files);
  const found = (res.findings ?? []).filter((f) => inPr.has(f.file) && BLOCKING_SEMGREP.has(f.severity));
  return check("semgrep", found.map((f) => `${f.file}:${f.line} ${f.rule}`), "no semgrep findings in the PR's files");
}

/** Every security and privacy check of the PR's diff. */
export async function prSecurityChecks({ diff, projectDir, config, range }) {
  const files = splitAddedByFile(diff).map((f) => f.file);
  // KJC-TSK-1112/1152: the reviewed repo's allow list and test paths, as they stand at the base.
  const repo = await repoPrivacyPolicy({ projectDir, range });
  return [
    secretsCheck(diff, config),
    privacyCheck(diff, { list: withRepoAllow(loadPrivacyList(), repo.allow), testPaths: repo.testPaths }),
    injectionCheck(diff),
    await cooldownCheck(diff, { thresholdHours: config?.supply_chain?.cooldown_hours }),
    await semgrepCheck({ projectDir, files }),
  ];
}
