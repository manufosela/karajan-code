/**
 * BecarIA CI/CD integration — early PR creation, incremental push, review dispatch.
 * Extracted from orchestrator.js — self-contained feature, only active when becaria.enabled.
 */
import { saveSession } from "../session-store.js";
import { earlyPrCreation, incrementalPush } from "../git/automation.js";
import { emitProgress, makeEvent } from "../utils/events.js";

export async function tryBecariaComment({ config, session, logger, agent, body }) {
  if (!config.becaria?.enabled || !session.becaria_pr_number) return;
  try {
    const { dispatchComment } = await import("../becaria/dispatch.js");
    const { detectRepo } = await import("../becaria/repo.js");
    const repo = await detectRepo();
    if (repo) {
      await dispatchComment({
        repo, prNumber: session.becaria_pr_number, agent,
        body, becariaConfig: config.becaria
      });
    }
  } catch { /* non-blocking */ }
}

export function formatCommitList(commits) {
  return commits.map((c) => `- \`${c.hash.slice(0, 7)}\` ${c.message}`).join("\n");
}

async function becariaIncrementalPush({ config, session, gitCtx, task, logger, repo, dispatchComment }) {
  const pushResult = await incrementalPush({ gitCtx, task, logger, session });
  if (!pushResult) return;

  const { accumulateCommit } = await import("../planning-game/pipeline-adapter.js");
  for (const c of pushResult.commits) accumulateCommit(session, c);

  session.becaria_commits = [...(session.becaria_commits ?? []), ...pushResult.commits];
  await saveSession(session);

  if (!repo) return;
  const feedback = session.last_reviewer_feedback || "N/A";
  await dispatchComment({
    repo, prNumber: session.becaria_pr_number, agent: "Coder",
    body: `Issues corregidos:\n${feedback}\n\nCommits:\n${formatCommitList(pushResult.commits)}`,
    becariaConfig: config.becaria
  });
}

async function becariaCreateEarlyPr({ config, session, emitter, eventBase, gitCtx, task, logger, stageResults, i, repo, dispatchComment }) {
  const earlyPr = await earlyPrCreation({ gitCtx, task, logger, session, stageResults });
  if (!earlyPr) return;

  const { accumulateCommit } = await import("../planning-game/pipeline-adapter.js");
  for (const c of earlyPr.commits) accumulateCommit(session, c);

  session.becaria_pr_number = earlyPr.prNumber;
  session.becaria_pr_url = earlyPr.prUrl;
  session.becaria_commits = earlyPr.commits;
  await saveSession(session);
  emitProgress(emitter, makeEvent("becaria:pr-created", { ...eventBase, stage: "becaria" }, {
    message: `Early PR created: #${earlyPr.prNumber}`,
    detail: { prNumber: earlyPr.prNumber, prUrl: earlyPr.prUrl }
  }));

  if (!repo) return;
  await dispatchComment({
    repo, prNumber: earlyPr.prNumber, agent: "Coder",
    body: `Iteración ${i} completada.\n\nCommits:\n${formatCommitList(earlyPr.commits)}`,
    becariaConfig: config.becaria
  });
}

export async function handleBecariaEarlyPrOrPush({ becariaEnabled, config, session, emitter, eventBase, gitCtx, task, logger, stageResults, i }) {
  if (!becariaEnabled) return;

  try {
    const { dispatchComment } = await import("../becaria/dispatch.js");
    const { detectRepo } = await import("../becaria/repo.js");
    const repo = await detectRepo();

    if (session.becaria_pr_number) {
      await becariaIncrementalPush({ config, session, gitCtx, task, logger, repo, dispatchComment });
    } else {
      await becariaCreateEarlyPr({ config, session, emitter, eventBase, gitCtx, task, logger, stageResults, i, repo, dispatchComment });
    }
  } catch (err) {
    logger.warn(`BecarIA early PR/push failed (non-blocking): ${err.message}`);
  }
}

export function formatBlockingIssues(issues) {
  return issues?.map((x) => `- ${x.id || "ISSUE"} [${x.severity || ""}] ${x.description}`).join("\n") || "";
}

export function formatSuggestions(suggestions) {
  return suggestions?.map((s) => {
    const detail = typeof s === "string" ? s : `${s.id || ""} ${s.description || s}`;
    return `- ${detail}`;
  }).join("\n") || "";
}

export function buildReviewCommentBody(review, i) {
  const status = review.approved ? "APPROVED" : "REQUEST_CHANGES";
  const blocking = formatBlockingIssues(review.blocking_issues);
  const suggestions = formatSuggestions(review.non_blocking_suggestions);
  let body = `Review iteración ${i}: ${status}`;
  if (blocking) body += `\n\n**Blocking:**\n${blocking}`;
  if (suggestions) body += `\n\n**Suggestions:**\n${suggestions}`;
  return body;
}

export async function handleBecariaReviewDispatch({ becariaEnabled, config, session, review, i, logger }) {
  if (!becariaEnabled || !session.becaria_pr_number) return;

  try {
    const { dispatchReview, dispatchComment } = await import("../becaria/dispatch.js");
    const { detectRepo } = await import("../becaria/repo.js");
    const repo = await detectRepo();
    if (!repo) return;

    const bc = config.becaria;
    const reviewEvent = review.approved ? "APPROVE" : "REQUEST_CHANGES";
    const reviewBody = review.approved
      ? (review.summary || "Approved")
      : (formatBlockingIssues(review.blocking_issues) || review.summary || "Changes requested");

    await dispatchReview({
      repo, prNumber: session.becaria_pr_number,
      event: reviewEvent, body: reviewBody, agent: "Reviewer", becariaConfig: bc
    });

    await dispatchComment({
      repo, prNumber: session.becaria_pr_number, agent: "Reviewer",
      body: buildReviewCommentBody(review, i), becariaConfig: bc
    });

    logger.info(`BecarIA: dispatched review for PR #${session.becaria_pr_number}`);
  } catch (err) {
    logger.warn(`BecarIA dispatch failed (non-blocking): ${err.message}`);
  }
}
