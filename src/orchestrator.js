import fs from "node:fs/promises";
import { createAgent } from "./agents/index.js";
import { addCheckpoint, createSession, loadSession, markSessionStatus, saveSession } from "./session-store.js";
import { computeBaseRef, generateDiff } from "./review/diff-generator.js";
import { validateReviewResult } from "./review/schema.js";
import { buildCoderPrompt } from "./prompts/coder.js";
import { buildReviewerPrompt } from "./prompts/reviewer.js";
import { getOpenIssues, getQualityGateStatus } from "./sonar/api.js";
import { runSonarScan } from "./sonar/scanner.js";
import { shouldBlockByProfile, summarizeIssues } from "./sonar/enforcer.js";

function parseJsonOutput(raw) {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    const lines = cleaned.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function readReviewRules(path) {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return "Focus on critical issues only.";
  }
}

export async function runFlow({ task, config, logger, flags = {} }) {
  const coder = createAgent(config.coder, config, logger);
  const reviewer = createAgent(config.reviewer, config, logger);

  const baseRef = await computeBaseRef({ baseBranch: config.base_branch, baseRef: flags.baseRef || null });
  const session = await createSession({
    task,
    config_snapshot: config,
    base_ref: baseRef,
    session_start_sha: baseRef,
    last_reviewer_feedback: null,
    repeated_issue_count: 0
  });

  const startedAt = Date.now();
  const reviewRules = await readReviewRules(config.review_rules);

  for (let i = 1; i <= config.max_iterations; i += 1) {
    const elapsedMinutes = (Date.now() - startedAt) / 60000;
    if (elapsedMinutes > config.session.max_total_minutes) {
      await markSessionStatus(session, "failed");
      throw new Error("Session timed out");
    }

    logger.info(`Iteration ${i}/${config.max_iterations}`);

    const coderPrompt = buildCoderPrompt({
      task,
      reviewerFeedback: session.last_reviewer_feedback,
      sonarSummary: session.last_sonar_summary
    });
    const coderResult = await coder.runTask({ prompt: coderPrompt });
    if (!coderResult.ok) {
      await markSessionStatus(session, "failed");
      throw new Error(`Coder failed: ${coderResult.error || coderResult.output}`);
    }

    await addCheckpoint(session, { stage: "coder", iteration: i, note: "Coder applied changes" });

    if (config.sonarqube.enabled) {
      const scan = await runSonarScan(config);
      if (!scan.ok) {
        await markSessionStatus(session, "failed");
        throw new Error(`Sonar scan failed: ${scan.stderr || scan.stdout}`);
      }

      const gate = await getQualityGateStatus(config);
      const issues = await getOpenIssues(config);
      session.last_sonar_summary = `QualityGate=${gate.status}; Open issues=${issues.total}; ${summarizeIssues(issues.issues)}`;
      await addCheckpoint(session, {
        stage: "sonar",
        iteration: i,
        quality_gate: gate.status,
        open_issues: issues.total
      });

      if (shouldBlockByProfile({ gateStatus: gate.status, profile: config.sonarqube.enforcement_profile })) {
        session.last_reviewer_feedback = `Sonar gate blocking (${gate.status}). Resolve critical findings first.`;
        session.repeated_issue_count += 1;
        await saveSession(session);
        if (session.repeated_issue_count >= config.session.fail_fast_repeats) {
          await markSessionStatus(session, "failed");
          throw new Error("Fail-fast triggered: repeated Sonar blocking issues");
        }
        continue;
      }
    }

    const diff = await generateDiff({ baseRef: session.session_start_sha });
    const reviewerPrompt = buildReviewerPrompt({
      task,
      diff,
      reviewRules,
      mode: config.review_mode
    });
    const reviewerResult = await reviewer.reviewTask({ prompt: reviewerPrompt });
    if (!reviewerResult.ok) {
      await markSessionStatus(session, "failed");
      throw new Error(`Reviewer failed: ${reviewerResult.error || reviewerResult.output}`);
    }

    const parsed = parseJsonOutput(reviewerResult.output);
    if (!parsed) {
      await markSessionStatus(session, "failed");
      throw new Error("Reviewer output is not valid JSON");
    }

    const review = validateReviewResult(parsed);
    await addCheckpoint(session, {
      stage: "reviewer",
      iteration: i,
      approved: review.approved,
      blocking_issues: review.blocking_issues.length
    });

    if (review.approved) {
      await markSessionStatus(session, "approved");
      return { approved: true, sessionId: session.id, review };
    }

    session.last_reviewer_feedback = review.blocking_issues
      .map((x) => `${x.id || "ISSUE"}: ${x.description || "Missing description"}`)
      .join("\n");
    session.repeated_issue_count += 1;
    await saveSession(session);

    if (session.repeated_issue_count >= config.session.fail_fast_repeats) {
      await markSessionStatus(session, "failed");
      throw new Error("Fail-fast triggered: repeated blocking reviewer issues");
    }
  }

  await markSessionStatus(session, "failed");
  return { approved: false, sessionId: session.id, reason: "max_iterations" };
}

export async function resumeFlow({ sessionId, logger }) {
  const session = await loadSession(sessionId);
  logger.info(`Resuming session ${sessionId} with status ${session.status}`);
  return session;
}
