/**
 * KJC-TSK-1075 (#2227): review someone else's PR. kj's reviewer, the target
 * repo's rules (.karajan) and the provider the agent picks run over
 * base...head; no own-work gate applies (card, tests, policy, session RAG) and
 * no verdict is stored, so this mode never unlocks a commit (ADR 0015). The
 * own-work gate, reviewGateCommand, stays untouched.
 */
import { runCommand } from "../utils/process.js";
import { resolveRole } from "../config/role-resolver.js";
import { runOneShotReview } from "./one-shot-review.js";
import { prRequirementChecks, prSizeLimit } from "./pr-requirements.js";
import { splitAdvice } from "./split-advice.js";
import { isGenerated } from "./loc-budget.js";
import { prSecurityChecks } from "./pr-security.js";
import { sonarCheck } from "./pr-sonar.js";
import { batchDiff, splitByFile } from "./diff-batches.js";
import { lensTask } from "./review-lens.js";
import { DIFF_CLIP_CHARS } from "../prompts/diff-clip.js";

// KJC-BUG-0378: a reviewer call per batch; past this many, files are left out and named.
const MAX_REVIEW_BATCHES = 10;

const gitDiffOf = async (projectDir, range) => {
  const res = await runCommand("git", ["diff", range], { cwd: projectDir });
  if (res.exitCode !== 0) throw new Error(`git diff ${range} failed: ${(res.stderr || "").trim()}`);
  return res.stdout;
};

const finding = (i) => ({
  file: i.file ?? null, line: i.line ?? null, severity: i.severity ?? null,
  description: i.description ?? "", suggested_fix: i.suggested_fix ?? null,
});

/** The review as data: verdict, findings, suggestions, security checks and, apart, the house requirements. */
export async function thirdPartyReview({ range, config, projectDir, logger, task = null, gitDiff = gitDiffOf, run = runOneShotReview, requirements = prRequirementChecks, security = prSecurityChecks, sonar = sonarCheck, limit = DIFF_CLIP_CHARS, maxBatches = MAX_REVIEW_BATCHES, sizeLimit = null }) {
  const diff = await gitDiff(projectDir, range);
  // KJC-TSK-1076/1077: the PR's requirements and its security, with no tokens; they never stop the review.
  // KJC-BUG-0379 (#2263): the house requirements (size, commits, attribution, tests) travel apart:
  // on another repo with other conventions they must not read as findings next to security.
  const policyChecks = await requirements({ range, projectDir, config });
  const checks = [...await security({ diff, projectDir, config, range }), await sonar({ diff, config, projectDir })];
  // KJC-BUG-0378 (#2263): the whole diff, in batches of whole files that fit the reviewer's
  // prompt; what does not fit is named in the coverage and the verdict cannot be approved.
  const provider = resolveRole(config, "reviewer").provider || null;
  const { batches, coverage } = batchDiff(diff, { limit, maxBatches });
  if (coverage.files.total === 0) throw new Error(`nothing to review — ${range} has no file changes`);
  const records = [];
  for (const batch of batches) {
    records.push(await run({ diff: batch.text, task, config, logger, projectDir, reviewerOverride: provider, persist: false }));
  }
  return {
    mode: "third-party",
    range,
    reviewer: records[0]?.reviewer ?? provider,
    verdict: verdictOf(records, coverage),
    coverage,
    findings: records.flatMap((r) => (r.issues ?? []).map(finding)),
    suggestions: records.flatMap((r) => r.suggestions ?? []),
    checks,
    policyChecks,
    advice: adviceFor(diff, sizeLimit ?? prSizeLimit({ projectDir, config }).limit),
  };
}

/** KJC-TSK-1101: over the size budget, how to split the PR; advice only, never a finding. */
function adviceFor(diff, budget) {
  const files = splitByFile(diff).filter((f) => !isGenerated(f.file));
  const total = files.reduce((n, f) => n + f.changed, 0);
  return total > budget ? { split: splitAdvice(files, { limit: budget }) } : {};
}

/** Rejected if any batch was; approved only when every file was reviewed; partial otherwise. */
function verdictOf(records, coverage) {
  let status = "approved";
  if (records.some((r) => r.verdict !== "approved")) status = "rejected";
  else if (coverage.truncated) status = "partial";
  const summary = records.map((r) => r.summary).filter(Boolean).join("\n");
  return { status, approved: status === "approved", summary };
}

/**
 * The CLI side: stdout carries exactly one JSON document, logs go to stderr.
 * Exit 0 whatever the PR's verdict (the agent decides what to post); non-zero
 * only when kj itself fails.
 */
export async function thirdPartyReviewCommand({ flags, config, out = process.stdout, err = process.stderr, review = thirdPartyReview }) {
  const print = (doc) => out.write(`${JSON.stringify(doc)}\n`);
  if (!flags.range) {
    print({ error: "--third-party reviews a range: pass --range <base>...<head>" });
    return 1;
  }
  const log = (msg) => err.write(`${msg}\n`);
  const logger = { info: log, warn: log, error: log, debug: () => {} };
  try {
    // KJC-TSK-1117: a lens (qa) puts its rubric before the task.
    const task = await lensTask(flags.lens ?? null, flags.task ?? null);
    print(await review({ range: flags.range, config, projectDir: config.projectDir || process.cwd(), logger, task }));
    return 0;
  } catch (e) {
    print({ error: e.message });
    return 1;
  }
}
