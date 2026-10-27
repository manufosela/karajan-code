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
import { thirdPartyTask } from "./untrusted-context.js";
import { readTaskFile } from "../utils/task-file.js";
import { DIFF_CLIP_CHARS } from "../prompts/diff-clip.js";
import { assertCrossFamily, verifyFindings } from "./run-verifier.js";
import { reconcileReviews } from "./dual-review.js";

// KJC-BUG-0378: a reviewer call per batch; past this many, files are left out and named.
const MAX_REVIEW_BATCHES = 10;

const gitDiffOf = async (projectDir, range) => {
  const res = await runCommand("git", ["diff", range], { cwd: projectDir });
  if (res.exitCode !== 0) throw new Error(`git diff ${range} failed: ${(res.stderr || "").trim()}`);
  return res.stdout;
};

// KJC-TSK-1195: the category travels too, so a security finding stays out of the verifier's reach.
const finding = (i) => ({
  file: i.file ?? null, line: i.line ?? null, severity: i.severity ?? null, category: i.category ?? null,
  description: i.description ?? "", suggested_fix: i.suggested_fix ?? null,
});

/** The review as data: verdict, findings, suggestions, security checks and, apart, the house requirements. */
export async function thirdPartyReview({ range, config, projectDir, logger, task = null, gitDiff = gitDiffOf, run = runOneShotReview, requirements = prRequirementChecks, security = prSecurityChecks, sonar = sonarCheck, limit = DIFF_CLIP_CHARS, maxBatches = MAX_REVIEW_BATCHES, sizeLimit = null, verifier = null, verifierModel = null, verify = verifyFindings, reviewers = null }) {
  // KJC-TSK-1195: a verifier of the reviewer's own family is refused before any token is spent.
  const reviewerRole = resolveRole(config, "reviewer");
  if (verifier) assertCrossFamily({ reviewer: reviewerRole.provider, reviewerModel: reviewerRole.model, verifier, verifierModel, logger });
  // KJC-TSK-1248 (#2623): two reviewers of the same family would share their blind spots.
  if (reviewers) assertCrossFamily({ reviewer: reviewers[0].provider, reviewerModel: reviewers[0].model, verifier: reviewers[1].provider, verifierModel: reviewers[1].model, logger, flag: "--reviewers" });
  const diff = await gitDiff(projectDir, range);
  // KJC-TSK-1076/1077: the PR's requirements and its security, with no tokens; they never stop the review.
  // KJC-BUG-0379 (#2263): the house requirements (size, commits, attribution, tests) travel apart:
  // on another repo with other conventions they must not read as findings next to security.
  const policyChecks = await requirements({ range, projectDir, config });
  const checks = [...await security({ diff, projectDir, config, range }), await sonar({ diff, config, projectDir })];
  // KJC-BUG-0378 (#2263): the whole diff, in batches of whole files that fit the reviewer's
  // prompt; what does not fit is named in the coverage and the verdict cannot be approved.
  const provider = reviewerRole.provider || null;
  const { batches, coverage } = batchDiff(diff, { limit, maxBatches });
  if (coverage.files.total === 0) throw new Error(`nothing to review — ${range} has no file changes`);
  const reviewWith = async (who, cfg) => {
    const recs = [];
    for (const batch of batches) recs.push(await run({ diff: batch.text, task, config: cfg, logger, projectDir, reviewerOverride: who, persist: false }));
    return recs;
  };
  if (reviewers) {
    const dual = await dualReview({ reviewers, reviewWith, verify, diff, coverage, config, logger });
    return { mode: "third-party", range, ...dual, checks, policyChecks, advice: adviceFor(diff, sizeLimit ?? prSizeLimit({ projectDir, config }).limit) };
  }
  const records = await reviewWith(provider, config);
  const findings = records.flatMap((r) => (r.issues ?? []).map(finding));
  // KJC-TSK-1195 (#2369): with a verifier, the findings are the verified ones and the block says what changed.
  const verified = verifier ? await verify({ findings, diff, verifier, model: verifierModel, config, logger }) : null;
  return {
    mode: "third-party",
    range,
    reviewer: records[0]?.reviewer ?? provider,
    verdict: verdictOf(records, coverage),
    coverage,
    findings: verified ? verified.findings : findings,
    ...(verified && { verification: verified.verification }),
    suggestions: records.flatMap((r) => r.suggestions ?? []),
    checks,
    policyChecks,
    advice: adviceFor(diff, sizeLimit ?? prSizeLimit({ projectDir, config }).limit),
  };
}

/**
 * KJC-TSK-1248 (#2623): both reviewers review the whole range on their own, in parallel, each
 * with its model; each one's findings are verified by the other family; one reconciled result.
 */
async function dualReview({ reviewers, reviewWith, verify, diff, coverage, config, logger }) {
  const withModel = ({ provider, model }) => ({ ...config, roles: { ...config?.roles, reviewer: { ...config?.roles?.reviewer, provider, model } } });
  const records = await Promise.all(reviewers.map((r) => reviewWith(r.provider, withModel(r))));
  const sides = await Promise.all(reviewers.map(async (me, i) => {
    const other = reviewers[1 - i];
    const found = records[i].flatMap((r) => (r.issues ?? []).map(finding));
    const verified = await verify({ findings: found, diff, verifier: other.provider, model: other.model, config, logger });
    return { reviewer: me.provider, model: me.model, coverage, verdict: verdictOf(records[i], coverage), ...verified };
  }));
  const reconciled = reconcileReviews(sides);
  return { reviewer: reviewers.map((r) => r.provider).join("+"), ...reconciled, suggestions: records.flat().flatMap((r) => r.suggestions ?? []) };
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

// KJC-TSK-1153: flags of the own-work review that this mode would otherwise ignore in silence.
const OWN_WORK_FLAGS = { staged: "--staged", check: "--check", installGate: "--install-gate", prune: "--prune", dryRun: "--dry-run", publishPr: "--publish-pr", verifyPr: "--verify-pr", baseRef: "--base-ref", walkedWith: "--walked-with" };

/** KJC-TSK-1248: --reviewers a,b [--reviewer-models a=model,b=model] as two reviewers, or null. */
function reviewersOf(flags) {
  if (!flags.reviewers) {
    if (flags.reviewerModels) throw new Error("--reviewer-models needs --reviewers <a,b>");
    return null;
  }
  if (flags.verifier) throw new Error("--reviewers already verifies each reviewer with the other: drop --verifier");
  const providers = String(flags.reviewers).split(",").map((p) => p.trim()).filter(Boolean);
  if (providers.length !== 2) throw new Error("--reviewers takes exactly two providers of different families, e.g. claude,codex");
  const models = Object.fromEntries(String(flags.reviewerModels ?? "").split(",").filter(Boolean).map((pair) => pair.split("=").map((s) => s.trim())));
  return providers.map((provider) => ({ provider, model: models[provider] || null }));
}

function assertThirdPartyFlags(flags) {
  const used = Object.keys(OWN_WORK_FLAGS).filter((k) => flags[k]).map((k) => OWN_WORK_FLAGS[k]);
  if (flags.walked?.length) used.push("--walked");
  if (flags.sonar === false) used.push("--no-sonar");
  if (used.length) throw new Error(`${used.join(", ")} not used with --third-party; drop ${used.length > 1 ? "them" : "it"}`);
  if (flags.task && flags.taskFile) throw new Error("pass the PR context either as the task argument or with --task-file, not both");
}

/**
 * The CLI side: stdout carries exactly one JSON document, logs go to stderr.
 * Exit 0 whatever the PR's verdict (the agent decides what to post); non-zero
 * only when kj itself fails.
 */
export async function thirdPartyReviewCommand({ flags, config, out = process.stdout, err = process.stderr, review = thirdPartyReview, readTask = readTaskFile }) {
  const print = (doc) => out.write(`${JSON.stringify(doc)}\n`);
  if (!flags.range) {
    print({ error: "--third-party reviews a range: pass --range <base>...<head>" });
    return 1;
  }
  const log = (msg) => err.write(`${msg}\n`);
  const logger = { info: log, warn: log, error: log, debug: () => {} };
  const projectDir = config.projectDir || process.cwd();
  try {
    assertThirdPartyFlags(flags);
    // KJC-TSK-1153: the PR author's text, fenced as untrusted; KJC-TSK-1117: a lens puts its rubric first.
    const context = flags.taskFile ? await readTask(flags.taskFile, { projectDir }) : flags.task;
    const task = await lensTask(flags.lens ?? null, thirdPartyTask(context ?? null));
    if (flags.verifierModel && !flags.verifier) throw new Error("--verifier-model needs --verifier <provider>");
    const reviewers = reviewersOf(flags);
    print(await review({ range: flags.range, config, projectDir, logger, task, verifier: flags.verifier ?? null, verifierModel: flags.verifierModel ?? null, ...(reviewers && { reviewers }) }));
    return 0;
  } catch (e) {
    print({ error: e.message });
    return 1;
  }
}
