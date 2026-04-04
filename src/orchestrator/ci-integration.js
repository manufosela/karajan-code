/**
 * CI/CD integration — early PR creation, incremental push, review dispatch.
 * Extracted from orchestrator.js — self-contained feature, only active when ci.enabled.
 */
import { saveSession } from "../session-store.js";
import { earlyPrCreation, incrementalPush } from "../git/automation.js";
import { emitProgress, makeEvent } from "../utils/events.js";

export async function tryCiComment({ config, session, logger, agent, body }) {
  if (!config.ci?.enabled || !session.ci_pr_number) return;
  try {
    const { dispatchComment } = await import("../ci/dispatch.js");
    const { detectRepo } = await import("../ci/repo.js");
    const repo = await detectRepo();
    if (repo) {
      await dispatchComment({
        repo, prNumber: session.ci_pr_number, agent,
        body, ciConfig: config.ci
      });
    }
  } catch { /* non-blocking */ }
}

function formatCommitList(commits) {
  return commits.map((c) => `- \`${c.hash.slice(0, 7)}\` ${c.message}`).join("\n");
}

async function ciIncrementalPush({ config, session, gitCtx, task, logger, repo, dispatchComment }) {
  const pushResult = await incrementalPush({ gitCtx, task, logger, session });
  if (!pushResult) return;

  const { accumulateCommit } = await import("../planning-game/pipeline-adapter.js");
  for (const c of pushResult.commits) accumulateCommit(session, c);

  session.ci_commits = [...(session.ci_commits ?? []), ...pushResult.commits];
  await saveSession(session);

  if (!repo) return;
  const feedback = session.last_reviewer_feedback || "N/A";
  await dispatchComment({
    repo, prNumber: session.ci_pr_number, agent: "Coder",
    body: `Issues fixed:\n${feedback}\n\nCommits:\n${formatCommitList(pushResult.commits)}`,
    ciConfig: config.ci
  });
}

async function ciCreateEarlyPr({ config, session, emitter, eventBase, gitCtx, task, logger, stageResults, i, repo, dispatchComment }) {
  const earlyPr = await earlyPrCreation({ gitCtx, task, logger, session, stageResults });
  if (!earlyPr) return;

  const { accumulateCommit } = await import("../planning-game/pipeline-adapter.js");
  for (const c of earlyPr.commits) accumulateCommit(session, c);

  session.ci_pr_number = earlyPr.prNumber;
  session.ci_pr_url = earlyPr.prUrl;
  session.ci_commits = earlyPr.commits;
  await saveSession(session);
  emitProgress(emitter, makeEvent("ci:pr-created", { ...eventBase, stage: "ci" }, {
    message: `Early PR created: #${earlyPr.prNumber}`,
    detail: { prNumber: earlyPr.prNumber, prUrl: earlyPr.prUrl }
  }));

  if (!repo) return;
  await dispatchComment({
    repo, prNumber: earlyPr.prNumber, agent: "Coder",
    body: `Iteration ${i} completed.\n\nCommits:\n${formatCommitList(earlyPr.commits)}`,
    ciConfig: config.ci
  });
}

export async function handleCiEarlyPrOrPush({ ciEnabled, config, session, emitter, eventBase, gitCtx, task, logger, stageResults, i }) {
  if (!ciEnabled) return;

  try {
    const { dispatchComment } = await import("../ci/dispatch.js");
    const { detectRepo } = await import("../ci/repo.js");
    const repo = await detectRepo();

    if (session.ci_pr_number) {
      await ciIncrementalPush({ config, session, gitCtx, task, logger, repo, dispatchComment });
    } else {
      await ciCreateEarlyPr({ config, session, emitter, eventBase, gitCtx, task, logger, stageResults, i, repo, dispatchComment });
    }
  } catch (err) {
    logger.warn(`CI early PR/push failed (non-blocking): ${err.message}`);
  }
}

export function formatBlockingIssues(issues) {
  return issues?.map((x) => `- ${x.id || "ISSUE"} [${x.severity || ""}] ${x.description}`).join("\n") || "";
}

function formatSuggestions(suggestions) {
  return suggestions?.map((s) => {
    const detail = typeof s === "string" ? s : `${s.id || ""} ${s.description || s}`;
    return `- ${detail}`;
  }).join("\n") || "";
}

function buildReviewCommentBody(review, i) {
  const status = review.approved ? "APPROVED" : "REQUEST_CHANGES";
  const blocking = formatBlockingIssues(review.blocking_issues);
  const suggestions = formatSuggestions(review.non_blocking_suggestions);
  let body = `Review iteration ${i}: ${status}`;
  if (blocking) body += `\n\n**Blocking:**\n${blocking}`;
  if (suggestions) body += `\n\n**Suggestions:**\n${suggestions}`;
  return body;
}

export async function handleCiReviewDispatch({ ciEnabled, config, session, review, i, logger }) {
  if (!ciEnabled || !session.ci_pr_number) return;

  try {
    const { dispatchReview, dispatchComment } = await import("../ci/dispatch.js");
    const { detectRepo } = await import("../ci/repo.js");
    const repo = await detectRepo();
    if (!repo) return;

    const bc = config.ci;
    const reviewEvent = review.approved ? "APPROVE" : "REQUEST_CHANGES";
    const reviewBody = review.approved
      ? (review.summary || "Approved")
      : (formatBlockingIssues(review.blocking_issues) || review.summary || "Changes requested");

    await dispatchReview({
      repo, prNumber: session.ci_pr_number,
      event: reviewEvent, body: reviewBody, agent: "Reviewer", ciConfig: bc
    });

    await dispatchComment({
      repo, prNumber: session.ci_pr_number, agent: "Reviewer",
      body: buildReviewCommentBody(review, i), ciConfig: bc
    });

    logger.info(`CI: dispatched review for PR #${session.ci_pr_number}`);
  } catch (err) {
    logger.warn(`CI dispatch failed (non-blocking): ${err.message}`);
  }
}
